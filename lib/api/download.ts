// GET /api/download/[id]. Ver docs/SPEC.md secao 6.
//
// Devolve signed URL do Storage com validade de 5 minutos. Os buckets sao
// privados (spec 8): a URL assinada e o unico caminho de leitura.
import { bucketDoCaminho, caminhoNoBucket, type Dependencias } from './dependencias';
import { falha, naoAutenticado, naoEncontrado, ok } from './respostas';

/** Cinco minutos, como a spec 6 e a spec 8 exigem. */
export const VALIDADE_SEGUNDOS = 300;

export async function getDownload(
  arquivoId: string,
  deps: Dependencias,
): Promise<Response> {
  const usuario = await deps.usuario();
  if (!usuario) return naoAutenticado();

  const arquivo = await deps.obterArquivo(arquivoId);
  if (!arquivo || arquivo.user_id !== usuario.id) return naoEncontrado();

  let url: string;
  try {
    url = await deps.urlAssinada(
      bucketDoCaminho(arquivo.storage_path),
      caminhoNoBucket(arquivo.storage_path),
      VALIDADE_SEGUNDOS,
      arquivo.nome_original,
    );
  } catch (causa) {
    // Acontece quando o job de retencao ja apagou o objeto mas a linha ficou.
    console.error(`assinatura falhou para ${arquivoId}: ${String(causa)}`);
    return falha('Arquivo não está mais disponível para download.', 410);
  }

  return ok({
    arquivo_id: arquivo.id,
    nome: arquivo.nome_original,
    tipo: arquivo.tipo,
    tamanho_bytes: arquivo.tamanho_bytes,
    url,
    expira_em: new Date(deps.agora().getTime() + VALIDADE_SEGUNDOS * 1000).toISOString(),
  });
}
