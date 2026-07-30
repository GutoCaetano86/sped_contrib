// Configuracao compartilhada dos clientes Supabase.

/**
 * Le a variavel de ambiente e falha alto se faltar.
 *
 * Sem isto o erro aparece la na frente como "Invalid API key" numa chamada
 * qualquer, em vez de na inicializacao onde e obvio o que fazer.
 */
function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `Variavel de ambiente ${nome} nao definida. Copie .env.example para .env.local e preencha.`,
    );
  }
  return valor;
}

export const URL_SUPABASE = (): string => obrigatoria('NEXT_PUBLIC_SUPABASE_URL');

/**
 * Chave publicavel. Vai para o browser de proposito: quem protege os dados e
 * a RLS no banco, nao o segredo da chave.
 */
export const CHAVE_PUBLICAVEL = (): string =>
  obrigatoria('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
