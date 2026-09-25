// Módulo à parte porque acoes.ts é 'use server': Next exige que todo export
// de um arquivo 'use server' seja server action (função async), e isto é
// parsing puro.
//
// O GoTrue tem dois patamares de limite para envio de e-mail (cadastro e
// reenvio passam pelos dois, ver docs/BUGS-POS-DEPLOY.md B2): 60s por
// e-mail, com contagem regressiva na mensagem; e um teto por hora do SMTP
// embutido do Supabase, sem contagem — "email rate limit exceeded". O
// segundo é fácil de estourar em produção porque é por PROJETO, não por
// usuário: configurar SMTP próprio é pendência de projeto (ver CLAUDE.md).

/** Mensagem amigável para erro de rate limit do GoTrue, ou `null` se não for um. */
export function mensagemDeRateLimit(mensagemOriginal: string): string | null {
  const comContagem = /after (\d+) seconds?/i.exec(mensagemOriginal);
  if (comContagem) return `Aguarde ${comContagem[1]} segundos antes de tentar de novo.`;
  if (/rate limit/i.test(mensagemOriginal)) {
    return 'Muitas tentativas nesta hora. Aguarde um pouco antes de tentar de novo.';
  }
  return null;
}
