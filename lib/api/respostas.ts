// Formato de resposta das rotas. Ver docs/SPEC.md secao 6.
//
// "Erros seguem { erro: string, detalhes?: unknown } com status HTTP adequado."
// Concentrar isso aqui evita que cada rota invente o seu formato.

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export function ok(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: JSON_HEADERS });
}

export function falha(mensagem: string, status: number, detalhes?: unknown): Response {
  const corpo = detalhes === undefined ? { erro: mensagem } : { erro: mensagem, detalhes };
  return new Response(JSON.stringify(corpo), { status, headers: JSON_HEADERS });
}

/** 401 padrao, igual ao que o middleware devolve em /api/*. */
export const naoAutenticado = (): Response => falha('Não autenticado.', 401);

/**
 * 404 tambem para arquivo que existe mas e de outro usuario.
 *
 * 403 confirmaria que o id existe, o que ja e informacao sobre a conta alheia.
 * Em dado fiscal isso importa: revelar que um arquivo existe e vazamento.
 */
export const naoEncontrado = (): Response => falha('Arquivo não encontrado.', 404);

/**
 * Corpo JSON da requisicao, ou `null` se nao for JSON valido.
 *
 * Nunca lanca: corpo malformado e erro do cliente e tem de virar 400, nao 500.
 */
export async function corpoJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Limite de ocorrencias devolvidas e gravadas em `conversoes`.
 *
 * Um arquivo de 138 mil linhas produz dezenas de milhares de avisos. Sem o
 * corte, o JSON da resposta passaria de megabytes e a coluna jsonb cresceria
 * sem controle. Quem precisa da lista inteira tem a aba _ERROS do Excel.
 */
export const MAX_OCORRENCIAS = 200;

export interface OcorrenciasResumidas<T> {
  itens: T[];
  total: number;
  truncado: boolean;
}

export function resumirOcorrencias<T>(itens: T[]): OcorrenciasResumidas<T> {
  return {
    itens: itens.slice(0, MAX_OCORRENCIAS),
    total: itens.length,
    truncado: itens.length > MAX_OCORRENCIAS,
  };
}
