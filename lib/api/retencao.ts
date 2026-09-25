// Job diario de retencao (spec 8): apaga arquivo que passou do prazo do plano.
//
// Este e o unico codigo do projeto que apaga dado de TODOS os usuarios, e roda
// sem sessao. Tres travas, por isso:
//
//  1. exige o segredo do cron no header Authorization — sem ele, 401;
//  2. `?simular=1` devolve exatamente o que apagaria, sem apagar nada. Rode
//     assim na primeira vez;
//  3. Storage primeiro, banco depois. Na ordem inversa, uma falha deixaria
//     objeto orfao no bucket: invisivel, e cobrado.
//
// Apagar a linha de `arquivos` derruba junto as `conversoes` que a citam
// (cascade da migration). E o comportamento certo: a spec 8 fala em exclusao,
// nao em arquivamento, e guardar o historico de um arquivo que ja nao existe
// contraria a minimizacao da LGPD.
import { limitesDe } from '@/lib/plans';
import { caminhoNoBucket, type Bucket } from './dependencias';
import { falha, ok } from './respostas';

/** Quantos caminhos por chamada ao Storage. A API do Supabase aceita ate 1000. */
const LOTE = 500;

export interface ArquivoVencido {
  id: string;
  storage_path: string;
  user_id: string;
}

/** Objeto no Storage sem linha correspondente em `arquivos`. */
export interface ObjetoNoBucket {
  nome: string;
  criadoEm: string;
}

export interface DependenciasRetencao {
  /** Todos os perfis, para saber a retencao de cada dono. */
  planosDosUsuarios(): Promise<{ id: string; plano: string }[]>;
  /** Arquivos do usuario criados ANTES do limite. */
  arquivosAte(userId: string, limite: Date): Promise<ArquivoVencido[]>;
  removerObjetos(bucket: Bucket, caminhos: string[]): Promise<void>;
  apagarArquivos(ids: string[]): Promise<void>;

  /** Objetos sob o prefixo do usuario, para achar os orfaos. */
  listarObjetos(bucket: Bucket, prefixo: string): Promise<ObjetoNoBucket[]>;
  /** Todos os `storage_path` que o usuario tem registrados. */
  caminhosRegistrados(userId: string): Promise<string[]>;

  agora(): Date;
}

/**
 * Carencia antes de considerar um objeto orfao.
 *
 * O upload direto grava no Storage ANTES de a linha existir em `arquivos`
 * (ver lib/api/upload.ts): entre o PUT do navegador e a confirmacao ha uma
 * janela em que o objeto legitimamente nao tem dono. 24 h e folga suficiente
 * para nao matar envio em andamento.
 */
const HORAS_DE_CARENCIA = 24;

const emLotes = <T,>(itens: T[], tamanho: number): T[][] => {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
};

/** Bucket e caminho interno a partir do `storage_path` gravado no banco. */
function separar(caminho: string): { bucket: Bucket; dentro: string } {
  const bucket: Bucket = caminho.startsWith('outputs/') ? 'outputs' : 'uploads';
  return { bucket, dentro: caminho.replace(/^(uploads|outputs)\//, '') };
}

/**
 * Confere o segredo do cron.
 *
 * A Vercel manda `Authorization: Bearer $CRON_SECRET` nas invocacoes agendadas
 * quando a variavel existe. Sem a variavel configurada a rota fica FECHADA em
 * vez de aberta: uma rota que apaga dado de todo mundo nao pode ter modo
 * permissivo por engano de configuracao.
 */
export function segredoConfere(request: Request): boolean {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;
  const recebido = request.headers.get('authorization') ?? '';
  return recebido === `Bearer ${esperado}`;
}

export async function executarRetencao(
  request: Request,
  deps: DependenciasRetencao,
): Promise<Response> {
  if (!segredoConfere(request)) {
    return falha('Não autorizado.', 401);
  }

  const simular = new URL(request.url).searchParams.get('simular') === '1';
  const agora = deps.agora();

  const perfis = await deps.planosDosUsuarios();
  const porBucket = new Map<Bucket, string[]>();
  const idsParaApagar: string[] = [];
  const porPlano: Record<string, number> = {};

  for (const perfil of perfis) {
    const dias = limitesDe(perfil.plano).retencaoDias;
    const limite = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
    const vencidos = await deps.arquivosAte(perfil.id, limite);
    if (vencidos.length === 0) continue;

    porPlano[perfil.plano] = (porPlano[perfil.plano] ?? 0) + vencidos.length;
    for (const arquivo of vencidos) {
      const { bucket, dentro } = separar(arquivo.storage_path);
      porBucket.set(bucket, [...(porBucket.get(bucket) ?? []), dentro]);
      idsParaApagar.push(arquivo.id);
    }
  }

  // --- orfaos: objeto no Storage sem linha em `arquivos` -------------------
  // Sem esta varredura, um upload abandonado entre o PUT e a confirmacao
  // ficaria no bucket para sempre — invisivel para o usuario e contrariando o
  // prazo de retencao que a /privacidade promete.
  const limiteOrfao = new Date(agora.getTime() - HORAS_DE_CARENCIA * 60 * 60 * 1000);
  const orfaos: string[] = [];
  for (const perfil of perfis) {
    const registrados = new Set(
      (await deps.caminhosRegistrados(perfil.id)).map((c) => caminhoNoBucket(c)),
    );
    for (const objeto of await deps.listarObjetos('uploads', perfil.id)) {
      const caminho = `${perfil.id}/${objeto.nome}`;
      if (registrados.has(caminho)) continue;
      if (new Date(objeto.criadoEm) >= limiteOrfao) continue;
      orfaos.push(caminho);
    }
  }

  const resumo = {
    simulacao: simular,
    executado_em: agora.toISOString(),
    perfis: perfis.length,
    arquivos: idsParaApagar.length,
    orfaos: orfaos.length,
    por_plano: porPlano,
    por_bucket: Object.fromEntries([...porBucket].map(([b, c]) => [b, c.length])),
  };

  if (simular || (idsParaApagar.length === 0 && orfaos.length === 0)) return ok(resumo);

  try {
    // Storage primeiro; ver o cabecalho.
    for (const [bucket, caminhos] of porBucket) {
      for (const lote of emLotes(caminhos, LOTE)) {
        await deps.removerObjetos(bucket, lote);
      }
    }
    for (const lote of emLotes(idsParaApagar, LOTE)) {
      await deps.apagarArquivos(lote);
    }
    for (const lote of emLotes(orfaos, LOTE)) {
      await deps.removerObjetos('uploads', lote);
    }
  } catch (causa) {
    // Nunca registrar conteudo de arquivo em log (spec 8): so contagem.
    console.error(`retencao falhou apos ${idsParaApagar.length} alvos: ${String(causa)}`);
    return falha('Falha ao aplicar a retenção.', 500, resumo);
  }

  console.log(
    `retencao: ${idsParaApagar.length} arquivo(s) e ${orfaos.length} orfao(s) apagado(s)`,
  );
  return ok(resumo);
}
