// GET e DELETE /api/files/[id]. Complementa a spec 6 para atender a spec 7.4
// (tela de detalhe) e 7.5 (polling do estado "processando").
//
// A lista paginada de /api/files nao serve para a tela de detalhe: ela corta
// as ocorrencias e nao traz o resumo por registro. E o polling precisa de uma
// rota barata que devolva so o estado de UM arquivo.
import {
  bucketDoCaminho,
  caminhoNoBucket,
  type Dependencias,
  type RegistroArquivo,
  type RegistroConversao,
} from './dependencias';
import { falha, naoAutenticado, naoEncontrado, ok } from './respostas';

function detalheDaConversao(c: RegistroConversao) {
  return {
    conversao_id: c.id,
    direcao: c.direcao,
    status: c.status,
    arquivo_origem_id: c.arquivo_origem_id,
    arquivo_saida_id: c.arquivo_saida_id,
    total_linhas: c.total_linhas,
    total_registros: c.total_registros,
    resumo_registros: c.resumo_registros,
    erros: c.erros,
    avisos: c.avisos,
    duracao_ms: c.duracao_ms,
    criado_em: c.criado_em,
    concluido_em: c.concluido_em,
  };
}

function detalheDoArquivo(a: RegistroArquivo) {
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
  };
}

export async function getArquivo(id: string, deps: Dependencias): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const arquivo = await deps.obterArquivo(id);
  if (!arquivo || arquivo.user_id !== usuario.id) return naoEncontrado();

  const conversoes = await deps.conversoesDoArquivo(usuario.id, id);
  // A conversao que INTERESSA e aquela em que este arquivo foi a origem: e ela
  // que tem o resumo e as ocorrencias desta leitura.
  const comoOrigem = conversoes.filter((c) => c.arquivo_origem_id === id);

  // B5.2: este arquivo pode ser a SAIDA de uma conversao, e nao so a origem.
  // Sem isto a tela mostrava "Ainda não convertido" num arquivo que e
  // resultado, porque `comoOrigem` fica vazio para ele.
  const comoSaida = conversoes.find((c) => c.arquivo_saida_id === id) ?? null;
  const origemDaSaida = comoSaida ? await deps.obterArquivo(comoSaida.arquivo_origem_id) : null;

  return ok({
    ...detalheDoArquivo(arquivo),
    ultima_conversao: comoOrigem[0] ? detalheDaConversao(comoOrigem[0]) : null,
    conversoes: conversoes.map(detalheDaConversao),
    gerado_por: comoSaida
      ? {
          conversao_id: comoSaida.id,
          direcao: comoSaida.direcao,
          arquivo_origem_id: comoSaida.arquivo_origem_id,
          arquivo_origem_nome: origemDaSaida?.nome_original ?? null,
        }
      : null,
  });
}

/**
 * Exclusao permanente (spec 8): tira do Storage e do banco.
 *
 * Storage primeiro. Se o banco falhasse depois de apagar o objeto, sobraria
 * uma linha apontando para nada — visivel e corrigivel. Na ordem inversa
 * sobraria um objeto orfao no bucket, invisivel e cobrado.
 */
export async function deleteArquivo(id: string, deps: Dependencias): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const arquivo = await deps.obterArquivo(id);
  if (!arquivo || arquivo.user_id !== usuario.id) return naoEncontrado();

  try {
    await deps.remover(
      bucketDoCaminho(arquivo.storage_path),
      caminhoNoBucket(arquivo.storage_path),
    );
    await deps.apagarArquivo(arquivo.id);
  } catch (causa) {
    console.error(`falha ao excluir ${id}: ${String(causa)}`);
    return falha('Não foi possível excluir o arquivo.', 500);
  }

  return ok({ arquivo_id: arquivo.id, excluido: true });
}
