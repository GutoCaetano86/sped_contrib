// Configuracao compartilhada do Sentry.
//
// REGRA DESTE PROJETO: nunca sai daqui conteudo de arquivo fiscal. Um TXT da
// EFD tem faturamento, participantes e CNPJ; mandar isso para um servico de
// terceiro seria pior que nao ter monitoramento nenhum. `limparEvento` e a
// trava, e ela roda em TODO evento, de servidor e de navegador.
import type { ErrorEvent } from '@sentry/nextjs';

/** Sem DSN o Sentry fica inerte — e o caso em desenvolvimento e nos testes. */
export const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

export const AMBIENTE = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';

/** Amostragem de traces. 10% em producao dá sinal sem custar caro. */
export const TAXA_TRACES = AMBIENTE === 'production' ? 0.1 : 0;

/**
 * Trechos que denunciam conteudo de arquivo fiscal numa mensagem de erro.
 *
 * O caso real: `validar()` monta mensagens como `Valor "3757,47" excede...`, e
 * o parser cita a linha inteira em alguns avisos. Sao exatamente os valores
 * que nao podem sair da aplicacao.
 */
const PADROES_SENSIVEIS: [RegExp, string][] = [
  // Linha inteira de registro: |C170|1|4-5000009137|...
  [/\|[0-9A-Z]{4}\|[^\n]*\|/g, '[linha de registro removida]'],
  // CNPJ e CPF soltos, com ou sem mascara.
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
  // Valor monetario entre aspas, que e como o validador cita.
  [/"[\d.]+,\d{2}"/g, '"[valor]"'],
];

export function limparTexto(texto: string): string {
  return PADROES_SENSIVEIS.reduce((t, [padrao, troca]) => t.replace(padrao, troca), texto);
}

/**
 * Passa o evento inteiro pelo filtro antes de sair.
 *
 * Tambem derruba o corpo da requisicao: um upload multipart carrega o arquivo
 * fiscal inteiro, e o Sentry o anexaria por padrao.
 */
export function limparEvento(evento: ErrorEvent): ErrorEvent | null {
  if (evento.message) evento.message = limparTexto(evento.message);

  for (const excecao of evento.exception?.values ?? []) {
    if (excecao.value) excecao.value = limparTexto(excecao.value);
  }

  if (evento.request) {
    delete evento.request.data;
    delete evento.request.cookies;
    if (evento.request.headers) {
      delete evento.request.headers.authorization;
      delete evento.request.headers.cookie;
    }
  }

  evento.breadcrumbs = evento.breadcrumbs?.map((migalha) => ({
    ...migalha,
    message: migalha.message ? limparTexto(migalha.message) : migalha.message,
    data: undefined,
  }));

  return evento;
}

/** Opcoes comuns aos tres runtimes (servidor, edge e navegador). */
export const opcoesComuns = {
  dsn: DSN,
  environment: AMBIENTE,
  tracesSampleRate: TAXA_TRACES,
  // Nunca anexar IP, cookie ou corpo de requisicao.
  sendDefaultPii: false,
  beforeSend: limparEvento,
  enabled: DSN !== '',
} as const;
