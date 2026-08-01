// GET /api/files?pagina=1&por_pagina=20. Ver docs/SPEC.md secao 6.
//
// Lista arquivos e conversoes do usuario, mais recentes primeiro. Cada arquivo
// leva a ultima conversao em que foi origem, que e o que o dashboard mostra na
// coluna de status (spec 7.2), e a resposta traz a cota para a barra do topo.
import { conferirCota, limitesDe } from '@/lib/plans';
import type { Dependencias, RegistroArquivo, RegistroConversao } from './dependencias';
import { falha, naoAutenticado, ok } from './respostas';

const POR_PAGINA_PADRAO = 20;
const POR_PAGINA_MAX = 100;

/** Inteiro positivo do query string, ou o padrao. */
function inteiro(valor: string | null, padrao: number, maximo: number): number | null {
  if (valor === null || valor === '') return padrao;
  if (!/^\d+$/.test(valor)) return null;
  const n = Number(valor);
  if (n < 1 || n > maximo) return null;
  return n;
}

/** Primeiro instante do mes corrente, para a cota mensal. */
const inicioDoMes = (agora: Date): Date =>
  new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));

/** Resumo da conversao para a lista; a lista de ocorrencias fica de fora. */
function resumoDaConversao(c: RegistroConversao) {
  return {
    conversao_id: c.id,
    direcao: c.direcao,
    status: c.status,
    arquivo_saida_id: c.arquivo_saida_id,
    total_linhas: c.total_linhas,
    total_registros: c.total_registros,
    total_erros: c.erros.length,
    total_avisos: c.avisos.length,
    duracao_ms: c.duracao_ms,
    criado_em: c.criado_em,
    concluido_em: c.concluido_em,
  };
}

function resumoDoArquivo(
  a: RegistroArquivo,
  ultima: RegistroConversao | undefined,
  geradoPor: RegistroConversao | undefined,
) {
  return {
    arquivo_id: a.id,
    nome: a.nome_original,
    tipo: a.tipo,
    tamanho_bytes: a.tamanho_bytes,
    cnpj: a.cnpj,
    razao_social: a.razao_social,
    periodo_inicio: a.periodo_inicio,
    periodo_fim: a.periodo_fim,
    criado_em: a.criado_em,
    ultima_conversao: ultima ? resumoDaConversao(ultima) : null,
    // Preenchido quando ESTE arquivo e a saida de uma conversao. Sem isto a
    // lista mostra "nao convertido" num arquivo que e resultado, e nao entrada.
    gerado_por: geradoPor ? resumoDaConversao(geradoPor) : null,
  };
}

export async function getFiles(request: Request, deps: Dependencias): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const params = new URL(request.url).searchParams;
  const pagina = inteiro(params.get('pagina'), 1, 10_000);
  const porPagina = inteiro(params.get('por_pagina'), POR_PAGINA_PADRAO, POR_PAGINA_MAX);
  if (pagina === null || porPagina === null) {
    return falha(
      `Paginação inválida. "pagina" começa em 1 e "por_pagina" vai até ${POR_PAGINA_MAX}.`,
      400,
    );
  }

  const { itens, total } = await deps.listarArquivos(
    usuario.id,
    (pagina - 1) * porPagina,
    porPagina,
  );

  const conversoes = await deps.conversoesDeArquivos(
    usuario.id,
    itens.map((a) => a.id),
  );

  // A ultima conversao de cada arquivo. `listarArquivos` ja devolve ordenado,
  // mas as conversoes nao, entao a comparacao e explicita.
  const ultimaPorArquivo = new Map<string, RegistroConversao>();
  const geradoPor = new Map<string, RegistroConversao>();
  for (const c of conversoes) {
    const atual = ultimaPorArquivo.get(c.arquivo_origem_id);
    if (!atual || c.criado_em > atual.criado_em) {
      ultimaPorArquivo.set(c.arquivo_origem_id, c);
    }
    if (c.arquivo_saida_id) geradoPor.set(c.arquivo_saida_id, c);
  }

  const plano = await deps.plano(usuario.id);
  const limites = limitesDe(plano);
  const noMes = await deps.contarConversoes(usuario.id, inicioDoMes(deps.agora()));
  const cota = conferirCota(plano, noMes);

  return ok({
    pagina,
    por_pagina: porPagina,
    total,
    total_paginas: Math.max(1, Math.ceil(total / porPagina)),
    arquivos: itens.map((a) =>
      resumoDoArquivo(a, ultimaPorArquivo.get(a.id), geradoPor.get(a.id)),
    ),
    conversoes: conversoes
      .slice()
      .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1))
      .map(resumoDaConversao),
    cota: {
      plano: limites.rotulo,
      conversoes_no_mes: noMes,
      limite_mensal: limites.conversoesPorMes,
      restantes: cota.restantes,
      tamanho_maximo_bytes: limites.tamanhoMaximoBytes,
      retencao_dias: limites.retencaoDias,
    },
  });
}
