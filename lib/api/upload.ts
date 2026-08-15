// Upload em dois passos. Ver docs/SPEC.md secao 6 e docs/BUGS-POS-DEPLOY.md B3.
//
// POR QUE NAO E MAIS UM POST COM O ARQUIVO NO CORPO
// A Vercel corta requisicao acima de 4.500.000 bytes ANTES de chamar a funcao,
// e responde `FUNCTION_PAYLOAD_TOO_LARGE` em texto puro. Medido em producao:
// 4.490.000 bytes passam, 4.500.000 nao. Um TXT de EFD tem 17 MB, entao o
// caminho antigo nunca funcionaria para o caso de uso do produto.
//
// Agora sao dois passos:
//
//   1. POST /api/upload/assinar   -> o servidor valida nome e tamanho contra o
//      plano e devolve uma URL assinada do Storage;
//   2. o NAVEGADOR envia os bytes direto para o Supabase, sem passar pela
//      funcao — e por isso o limite da plataforma deixa de valer;
//   3. POST /api/upload/confirmar -> o servidor baixa o que foi gravado,
//      valida assinatura e tamanho DE VERDADE, le o cabecalho 0000 e insere a
//      linha em `arquivos`.
//
// O passo 3 revalida tudo porque o passo 1 confia no que o cliente declarou.
// Entre um e outro o navegador pode ter enviado outra coisa: quem manda e o
// que esta no Storage, nao o que foi prometido.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { conferirTamanho, limitesDe } from '@/lib/plans';
import type { Dependencias, TipoArquivo } from './dependencias';
import { corpoJson, falha, naoAutenticado, ok } from './respostas';

/** Assinatura de ZIP; todo XLSX e um ZIP. */
const ASSINATURA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const CONTENT_TYPE: Record<TipoArquivo, string> = {
  txt: 'text/plain; charset=iso-8859-1',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Extensao do nome do arquivo, em minusculas e sem o ponto. */
function extensaoDe(nome: string): TipoArquivo | null {
  const ponto = nome.lastIndexOf('.');
  const ext = ponto === -1 ? '' : nome.slice(ponto + 1).toLowerCase();
  return ext === 'txt' || ext === 'xlsx' ? ext : null;
}

/**
 * Primeira linha tem de comecar com `|0000|` (spec 6).
 *
 * BOM de UTF-8 aparece quando o arquivo passou por editor de texto. O parser
 * avisa e remove; aqui nao e motivo para recusar.
 */
function comecaCom0000(bytes: Buffer): boolean {
  const inicio = bytes.subarray(0, 64).toString('latin1');
  return inicio.replace(/^(﻿|ï»¿)/, '').startsWith('|0000|');
}

/** CNPJ, razao social e periodo do registro 0000, para a lista de arquivos. */
function metadadosDoTxt(bytes: Buffer) {
  const vazio = { cnpj: null, razao_social: null, periodo_inicio: null, periodo_fim: null };
  const primeira = bytes.subarray(0, 4096).toString('latin1').split(/\r?\n/)[0] ?? '';
  if (!primeira.startsWith('|')) return vazio;

  const v = primeira.slice(1).split('|');
  // Campos do 0000: 06 DT_INI, 07 DT_FIN, 08 NOME, 09 CNPJ (v[0] e o REG).
  const data = (ddmmaaaa: string | undefined): string | null =>
    ddmmaaaa && /^\d{8}$/.test(ddmmaaaa)
      ? `${ddmmaaaa.slice(4)}-${ddmmaaaa.slice(2, 4)}-${ddmmaaaa.slice(0, 2)}`
      : null;

  return {
    periodo_inicio: data(v[5]),
    periodo_fim: data(v[6]),
    razao_social: v[7] || null,
    cnpj: v[8] || null,
  };
}

// ---------------------------------------------------------------- passo 1
const PedidoAssinatura = z.object({
  nome: z.string().min(1).max(255),
  tamanho_bytes: z.number().int().nonnegative(),
});

export async function postAssinarUpload(
  request: Request,
  deps: Dependencias,
): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const pedido = PedidoAssinatura.safeParse(await corpoJson(request));
  if (!pedido.success) return falha('Corpo inválido.', 400, pedido.error.issues);
  const { nome, tamanho_bytes } = pedido.data;

  const tipo = extensaoDe(nome);
  if (!tipo) {
    return falha('Extensão não suportada. Envie .txt ou .xlsx.', 400);
  }
  if (tamanho_bytes === 0) return falha('Arquivo vazio.', 400);

  const plano = await deps.plano(usuario.id);
  const cabe = conferirTamanho(plano, tamanho_bytes);
  if (!cabe.permitido) return falha(cabe.motivo, 413);

  // O objeto vive em uploads/{user_id}/, que e o que a politica de Storage
  // exige (F3-T1). O uuid impede colisao e impede adivinhar caminho alheio.
  const dentroDoBucket = `${usuario.id}/${deps.novoId()}.${tipo}`;
  const { url, token } = await deps.assinarUpload('uploads', dentroDoBucket);

  return ok({
    url,
    token,
    caminho: `uploads/${dentroDoBucket}`,
    tipo,
    content_type: CONTENT_TYPE[tipo],
    limite_bytes: limitesDe(plano).tamanhoMaximoBytes,
  });
}

// ---------------------------------------------------------------- passo 3
const PedidoConfirmacao = z.object({
  caminho: z.string().min(1),
  nome: z.string().min(1).max(255),
});

export async function postConfirmarUpload(
  request: Request,
  deps: Dependencias,
): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const pedido = PedidoConfirmacao.safeParse(await corpoJson(request));
  if (!pedido.success) return falha('Corpo inválido.', 400, pedido.error.issues);
  const { caminho, nome } = pedido.data;

  // O caminho vem do cliente, entao tem de ser conferido: sem isto alguem
  // confirmaria um objeto de outra conta e ganharia uma linha em `arquivos`
  // apontando para arquivo alheio. A politica de Storage ja barra a leitura,
  // mas a checagem aqui e a que impede o registro errado.
  const prefixo = `uploads/${usuario.id}/`;
  if (!caminho.startsWith(prefixo) || caminho.includes('..')) {
    return falha('Caminho inválido.', 400);
  }

  const tipo = extensaoDe(nome);
  if (!tipo) return falha('Extensão não suportada. Envie .txt ou .xlsx.', 400);

  const dentroDoBucket = caminho.slice('uploads/'.length);

  let bytes: Buffer;
  try {
    bytes = await deps.baixar('uploads', dentroDoBucket);
  } catch {
    return falha('O arquivo não chegou ao servidor. Tente enviar de novo.', 404);
  }

  /** Descarta o objeto antes de recusar: sem isto sobra lixo no bucket. */
  const recusar = async (mensagem: string, status = 400): Promise<Response> => {
    try {
      await deps.remover('uploads', dentroDoBucket);
    } catch (causa) {
      console.error(`nao consegui remover objeto recusado: ${String(causa)}`);
    }
    return falha(mensagem, status);
  };

  // Tamanho de VERDADE, e nao o que foi declarado no passo 1.
  const plano = await deps.plano(usuario.id);
  const cabe = conferirTamanho(plano, bytes.length);
  if (!cabe.permitido) return recusar(cabe.motivo, 413);
  if (bytes.length === 0) return recusar('Arquivo vazio.');

  if (tipo === 'xlsx' && !bytes.subarray(0, 4).equals(ASSINATURA_ZIP)) {
    return recusar('O arquivo não é um .xlsx válido (assinatura ZIP ausente).');
  }
  if (tipo === 'txt' && !comecaCom0000(bytes)) {
    return recusar(
      'A primeira linha não começa com |0000|. Não parece um arquivo da EFD-Contribuições.',
    );
  }

  const metadados =
    tipo === 'txt'
      ? metadadosDoTxt(bytes)
      : { cnpj: null, razao_social: null, periodo_inicio: null, periodo_fim: null };

  const registro = await deps.inserirArquivo({
    user_id: usuario.id,
    nome_original: nome,
    tipo,
    tamanho_bytes: bytes.length,
    storage_path: caminho,
    hash_sha256: createHash('sha256').update(bytes).digest('hex'),
    ...metadados,
  });

  return ok(
    {
      arquivo_id: registro.id,
      nome: registro.nome_original,
      tamanho_bytes: registro.tamanho_bytes,
      tipo: registro.tipo,
      // O preview da spec 7.3 existe para o usuario confirmar que subiu o
      // arquivo certo ANTES de gastar uma conversao da cota.
      cabecalho: {
        cnpj: registro.cnpj,
        razao_social: registro.razao_social,
        periodo_inicio: registro.periodo_inicio,
        periodo_fim: registro.periodo_fim,
      },
    },
    201,
  );
}
