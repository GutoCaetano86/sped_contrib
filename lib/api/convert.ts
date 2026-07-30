// POST /api/convert. Ver docs/SPEC.md secao 6.
//
// Confere cota mensal e rate limit, cria a conversao em `processando`, roda o
// pipeline, grava a saida no Storage e fecha a conversao.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CONVERSOES_POR_HORA, conferirCota, limitesDe } from '@/lib/plans';
import { lerExcel } from '@/lib/sped/from-excel';
import { obterLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import { serializarTxt } from '@/lib/sped/serializer';
import { gerarExcel } from '@/lib/sped/to-excel';
import { recalcularTotalizadores } from '@/lib/sped/totalizers';
import { validar } from '@/lib/sped/validator';
import type { ErroValidacao } from '@/lib/sped/types';
import {
  bucketDoCaminho,
  caminhoNoBucket,
  type Dependencias,
  type Direcao,
  type TipoArquivo,
} from './dependencias';
import { corpoJson, falha, naoAutenticado, naoEncontrado, ok, resumirOcorrencias } from './respostas';

const Pedido = z.object({
  arquivo_id: z.string().min(1),
  direcao: z.enum(['txt_para_xlsx', 'xlsx_para_txt']),
  incluir_descricoes: z.boolean().optional(),
});

/** Tipo de arquivo que cada direcao exige na entrada. */
const ENTRADA_DE: Record<Direcao, TipoArquivo> = {
  txt_para_xlsx: 'txt',
  xlsx_para_txt: 'xlsx',
};

const CONTENT_TYPE: Record<TipoArquivo, string> = {
  txt: 'text/plain; charset=iso-8859-1',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Sufixo do TXT reconvertido, a mesma convencao do CLI: nao sobrescreve o original. */
const SUFIXO_RECONVERTIDO = '_ajustado';

/** Primeiro instante do mes corrente, para a cota mensal (spec 6). */
function inicioDoMes(agora: Date): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
}

/** Nome do arquivo de saida a partir do nome de entrada. */
function nomeDaSaida(nomeEntrada: string, destino: TipoArquivo): string {
  const base = nomeEntrada.replace(/\.(txt|xlsx)$/i, '');
  return destino === 'xlsx' ? `${base}.xlsx` : `${base}${SUFIXO_RECONVERTIDO}.txt`;
}

/** Data `ddmmaaaa` do leiaute para `aaaa-mm-dd` do Postgres. */
const paraDataIso = (ddmmaaaa: string): string | null =>
  /^\d{8}$/.test(ddmmaaaa)
    ? `${ddmmaaaa.slice(4)}-${ddmmaaaa.slice(2, 4)}-${ddmmaaaa.slice(0, 2)}`
    : null;

export async function postConvert(request: Request, deps: Dependencias): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const bruto = await corpoJson(request);
  const pedido = Pedido.safeParse(bruto);
  if (!pedido.success) {
    return falha('Corpo inválido.', 400, pedido.error.issues);
  }
  const { arquivo_id, direcao, incluir_descricoes } = pedido.data;

  const arquivo = await deps.obterArquivo(arquivo_id);
  // Arquivo de outro usuario responde igual a arquivo inexistente: 403
  // confirmaria que o id existe.
  if (!arquivo || arquivo.user_id !== usuario.id) return naoEncontrado();

  const esperado = ENTRADA_DE[direcao];
  if (arquivo.tipo !== esperado) {
    return falha(
      `A direção "${direcao}" exige arquivo .${esperado}, e este é .${arquivo.tipo}.`,
      400,
    );
  }

  const plano = await deps.plano(usuario.id);
  const agora = deps.agora();

  // Rate limit antes da cota: e o limite mais curto e o mais barato de conferir
  // (spec 8, 10 conversoes/hora independente do plano).
  const umaHoraAtras = new Date(agora.getTime() - 60 * 60 * 1000);
  const naUltimaHora = await deps.contarConversoes(usuario.id, umaHoraAtras);
  if (naUltimaHora >= CONVERSOES_POR_HORA) {
    return falha(
      `Limite de ${CONVERSOES_POR_HORA} conversões por hora atingido. Tente mais tarde.`,
      429,
    );
  }

  const noMes = await deps.contarConversoes(usuario.id, inicioDoMes(agora));
  const cota = conferirCota(plano, noMes);
  if (!cota.permitido) {
    return falha(cota.motivo, 429, {
      plano: limitesDe(plano).rotulo,
      conversoes_no_mes: noMes,
      limite_mensal: limitesDe(plano).conversoesPorMes,
    });
  }

  const conversao = await deps.criarConversao({
    user_id: usuario.id,
    arquivo_origem_id: arquivo.id,
    direcao,
    status: 'processando',
  });

  const inicio = Date.now();
  try {
    const layout = obterLayout();
    const entrada = await deps.baixar(
      bucketDoCaminho(arquivo.storage_path),
      caminhoNoBucket(arquivo.storage_path),
    );

    const res =
      direcao === 'txt_para_xlsx' ? parseTxt(entrada, layout) : await lerExcel(entrada, layout);
    const validacao = validar(res.nos, layout);
    const erros: ErroValidacao[] = [...res.erros, ...validacao.erros];
    const avisos: ErroValidacao[] = [...res.avisos, ...validacao.avisos];

    // Assimetria da spec 11: erro NAO bloqueia TXT -> XLSX (o usuario quer ver
    // e corrigir na planilha) mas BLOQUEIA XLSX -> TXT, porque gerar arquivo
    // que o PVA recusa e pior que nao gerar.
    if (direcao === 'xlsx_para_txt' && erros.length > 0) {
      const resumo = resumirOcorrencias(erros);
      await deps.atualizarConversao(conversao.id, {
        status: 'erro',
        total_linhas: res.nos.length,
        erros: resumo.itens,
        avisos: resumirOcorrencias(avisos).itens,
        duracao_ms: Date.now() - inicio,
        concluido_em: deps.agora().toISOString(),
      });
      return ok(
        {
          conversao_id: conversao.id,
          status: 'erro',
          arquivo_saida_id: null,
          total_linhas: res.nos.length,
          total_registros: new Set(res.nos.map((n) => n.reg)).size,
          erros: resumo.itens,
          total_erros: resumo.total,
          avisos: [],
          total_avisos: avisos.length,
        },
        422,
      );
    }

    const destino: TipoArquivo = direcao === 'txt_para_xlsx' ? 'xlsx' : 'txt';
    const saida =
      direcao === 'txt_para_xlsx'
        ? await gerarExcel(res, layout, {
            incluirDescricoes: incluir_descricoes ?? false,
            arquivoOrigem: arquivo.nome_original,
            hashOrigem: arquivo.hash_sha256 ?? '',
          })
        : serializarTxt(recalcularTotalizadores(res.nos), avisos);

    const dentroDoBucket = `${usuario.id}/${deps.novoId()}.${destino}`;
    await deps.subir('outputs', dentroDoBucket, saida, CONTENT_TYPE[destino]);

    const registroSaida = await deps.inserirArquivo({
      user_id: usuario.id,
      nome_original: nomeDaSaida(arquivo.nome_original, destino),
      tipo: destino,
      tamanho_bytes: saida.length,
      storage_path: `outputs/${dentroDoBucket}`,
      hash_sha256: createHash('sha256').update(saida).digest('hex'),
      cnpj: res.cabecalho.cnpj || arquivo.cnpj,
      razao_social: res.cabecalho.razaoSocial || arquivo.razao_social,
      periodo_inicio: paraDataIso(res.cabecalho.dtIni) ?? arquivo.periodo_inicio,
      periodo_fim: paraDataIso(res.cabecalho.dtFin) ?? arquivo.periodo_fim,
    });

    const resumoErros = resumirOcorrencias(erros);
    const resumoAvisos = resumirOcorrencias(avisos);
    const duracao = Date.now() - inicio;

    await deps.atualizarConversao(conversao.id, {
      status: 'concluido',
      arquivo_saida_id: registroSaida.id,
      total_linhas: res.nos.length,
      total_registros: new Set(res.nos.map((n) => n.reg)).size,
      erros: resumoErros.itens,
      avisos: resumoAvisos.itens,
      duracao_ms: duracao,
      concluido_em: deps.agora().toISOString(),
    });

    return ok({
      conversao_id: conversao.id,
      status: 'concluido',
      arquivo_saida_id: registroSaida.id,
      total_linhas: res.nos.length,
      total_registros: new Set(res.nos.map((n) => n.reg)).size,
      erros: resumoErros.itens,
      total_erros: resumoErros.total,
      avisos: resumoAvisos.itens,
      total_avisos: resumoAvisos.total,
      duracao_ms: duracao,
    });
  } catch (causa) {
    // A conversao nao pode ficar presa em `processando`: o dashboard mostraria
    // spinner eterno. Nunca registrar conteudo de arquivo em log (spec 8).
    const mensagem = causa instanceof Error ? causa.message : String(causa);
    console.error(`conversao ${conversao.id} falhou: ${mensagem}`);
    await deps.atualizarConversao(conversao.id, {
      status: 'erro',
      duracao_ms: Date.now() - inicio,
      concluido_em: deps.agora().toISOString(),
      erros: [{ severidade: 'erro', mensagem: `Falha ao converter: ${mensagem}` }],
    });
    return falha('Falha ao converter o arquivo.', 500, { conversao_id: conversao.id });
  }
}
