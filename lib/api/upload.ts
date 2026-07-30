// POST /api/upload. Ver docs/SPEC.md secao 6.
//
// Valida extensao, tamanho (limite do plano), MIME e assinatura do arquivo;
// sobe para uploads/{user_id}/{uuid}.{ext} e insere em `arquivos`.
import { createHash } from 'node:crypto';
import { conferirTamanho, limitesDe } from '@/lib/plans';
import type { Dependencias, TipoArquivo } from './dependencias';
import { falha, naoAutenticado, ok } from './respostas';

const CAMPO = 'arquivo';

/**
 * MIME aceito por extensao.
 *
 * Lista permissiva de proposito: o navegador manda `text/plain`,
 * `application/vnd.ms-excel` ou `application/octet-stream` para o mesmo
 * arquivo, dependendo do sistema. Quem barra arquivo errado de verdade e a
 * assinatura, logo abaixo — a spec 8 pede exatamente "extensao e assinatura".
 */
const MIME_ACEITO: Record<TipoArquivo, RegExp> = {
  txt: /^(text\/|application\/(octet-stream|x-empty)$|$)/i,
  xlsx: /^(application\/(vnd\.openxmlformats|vnd\.ms-excel|zip|octet-stream|x-empty)|$)/i,
};

/** Assinatura de ZIP; todo XLSX e um ZIP. */
const ASSINATURA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Extensao do nome do arquivo, em minusculas e sem o ponto. */
function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto === -1 ? '' : nome.slice(ponto + 1).toLowerCase();
}

/**
 * Primeira linha tem de comecar com `|0000|` (spec 6).
 *
 * Le so o comeco do buffer: o registro 0000 e curto e nao ha motivo para
 * decodificar 17 MB para conferir 6 caracteres.
 */
function comecaCom0000(bytes: Buffer): boolean {
  const inicio = bytes.subarray(0, 64).toString('latin1');
  // BOM de UTF-8 aparece quando o arquivo passou por editor de texto. O parser
  // avisa e remove; aqui nao e motivo para recusar o upload.
  return inicio.replace(/^(﻿|ï»¿)/, '').startsWith('|0000|');
}

/** CNPJ, razao social e periodo do registro 0000, para a lista de arquivos. */
function metadadosDoTxt(bytes: Buffer): {
  cnpj: string | null;
  razao_social: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
} {
  const vazio = { cnpj: null, razao_social: null, periodo_inicio: null, periodo_fim: null };
  // Basta a primeira linha; parsear o arquivo inteiro aqui seria desperdicio,
  // porque /api/convert vai parsear de novo.
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

export async function postUpload(request: Request, deps: Dependencias): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const plano = await deps.plano(usuario.id);
  const limites = limitesDe(plano);

  // Recusa antes de bufferizar o corpo. `request.formData()` carrega tudo em
  // memoria, e um upload de 300 MB derrubaria a funcao antes de qualquer
  // validacao acontecer.
  const declarado = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declarado) && declarado > limites.tamanhoMaximoBytes) {
    return falha(conferirTamanho(plano, declarado).motivo, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return falha(`Envie multipart/form-data com o campo "${CAMPO}".`, 400);
  }

  const enviado = form.get(CAMPO);
  if (!(enviado instanceof File)) {
    return falha(`Campo "${CAMPO}" ausente ou não é um arquivo.`, 400);
  }

  const extensao = extensaoDe(enviado.name);
  if (extensao !== 'txt' && extensao !== 'xlsx') {
    return falha(
      `Extensão "${extensao || '(nenhuma)'}" não suportada. Envie .txt ou .xlsx.`,
      400,
    );
  }
  const tipo: TipoArquivo = extensao;

  const mime = enviado.type ?? '';
  if (!MIME_ACEITO[tipo].test(mime)) {
    return falha(`Tipo de conteúdo "${mime}" não corresponde a um arquivo .${tipo}.`, 400);
  }

  // O tamanho real manda: `content-length` inclui o overhead do multipart e
  // um cliente pode mentir no header.
  const tamanho = enviado.size;
  const cabe = conferirTamanho(plano, tamanho);
  if (!cabe.permitido) return falha(cabe.motivo, 413);
  if (tamanho === 0) return falha('Arquivo vazio.', 400);

  const bytes = Buffer.from(await enviado.arrayBuffer());

  if (tipo === 'xlsx' && !bytes.subarray(0, 4).equals(ASSINATURA_ZIP)) {
    return falha('O arquivo não é um .xlsx válido (assinatura ZIP ausente).', 400);
  }
  if (tipo === 'txt' && !comecaCom0000(bytes)) {
    return falha(
      'A primeira linha não começa com |0000|. Não parece um arquivo da EFD-Contribuições.',
      400,
    );
  }

  const metadados =
    tipo === 'txt'
      ? metadadosDoTxt(bytes)
      : { cnpj: null, razao_social: null, periodo_inicio: null, periodo_fim: null };

  // `storage_path` guarda o bucket no comeco, para o download saber de onde
  // buscar. Dentro do bucket o objeto e {user_id}/..., que e o que a politica
  // de Storage exige (F3-T1).
  const dentroDoBucket = `${usuario.id}/${deps.novoId()}.${tipo}`;
  const caminho = `uploads/${dentroDoBucket}`;
  await deps.subir(
    'uploads',
    dentroDoBucket,
    bytes,
    tipo === 'txt'
      ? 'text/plain; charset=iso-8859-1'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );

  const registro = await deps.inserirArquivo({
    user_id: usuario.id,
    nome_original: enviado.name,
    tipo,
    tamanho_bytes: tamanho,
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
    },
    201,
  );
}
