// Filtro do Sentry. Ver lib/observabilidade.ts.
//
// Este teste guarda uma promessa da página /privacidade: conteúdo de arquivo
// fiscal não sai da aplicação. Sem ele, uma mensagem de erro do validador
// levaria valores e CNPJ do cliente para um serviço de terceiro.
import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';
import { limparEvento, limparTexto, opcoesComuns } from '@/lib/observabilidade';

const evento = (dados: Partial<ErrorEvent>): ErrorEvent => dados as ErrorEvent;

describe('limparTexto', () => {
  it('remove a linha de registro inteira', () => {
    const cru =
      'Falha ao ler |C170|1|4-5000009137|ROHUHUL CUDORE VAHA|8|PC|553,6|0|0|090|1556|';
    expect(limparTexto(cru)).not.toContain('5000009137');
    expect(limparTexto(cru)).toContain('[linha de registro removida]');
  });

  it('mascara CNPJ com e sem pontuação', () => {
    expect(limparTexto('CNPJ 39189437736165 inválido')).toBe('CNPJ [cnpj] inválido');
    expect(limparTexto('CNPJ 39.189.437/7361-65 inválido')).toBe('CNPJ [cnpj] inválido');
  });

  it('mascara CPF', () => {
    expect(limparTexto('doc 123.456.789-09')).toBe('doc [cpf]');
  });

  it('mascara valor monetário citado pelo validador', () => {
    // O validador monta mensagens como: Valor "3757,47" excede o tamanho.
    const cru = 'Valor "3757,47" excede o tamanho do campo VL_DOC.';
    expect(limparTexto(cru)).toBe('Valor "[valor]" excede o tamanho do campo VL_DOC.');
  });

  it('não mexe em mensagem sem dado fiscal', () => {
    const cru = 'Aba _META ausente: não é um Excel gerado por esta ferramenta.';
    expect(limparTexto(cru)).toBe(cru);
  });
});

describe('limparEvento', () => {
  it('limpa mensagem e exceção', () => {
    const e = limparEvento(
      evento({
        message: 'erro em |0000|006|0|||01122021|31122021|EMPRESA|39189437736165|',
        exception: { values: [{ value: 'CNPJ 39189437736165 inválido' }] },
      }),
    );
    expect(e?.message).not.toContain('39189437736165');
    expect(e?.exception?.values?.[0]?.value).toBe('CNPJ [cnpj] inválido');
  });

  it('derruba o corpo da requisição, que num upload é o arquivo inteiro', () => {
    const e = limparEvento(
      evento({
        request: {
          data: 'conteudo do TXT inteiro',
          cookies: { 'sb-auth-token': 'segredo' },
          headers: { authorization: 'Bearer x', cookie: 'sb=1', 'user-agent': 'teste' },
        },
      }),
    );
    expect(e?.request?.data).toBeUndefined();
    expect(e?.request?.cookies).toBeUndefined();
    expect(e?.request?.headers?.authorization).toBeUndefined();
    expect(e?.request?.headers?.cookie).toBeUndefined();
    // O que não é sensível continua, senão o evento perde utilidade.
    expect(e?.request?.headers?.['user-agent']).toBe('teste');
  });

  it('limpa breadcrumb e descarta o payload dele', () => {
    const e = limparEvento(
      evento({
        breadcrumbs: [{ message: 'POST com CNPJ 39189437736165', data: { corpo: 'linha fiscal' } }],
      }),
    );
    expect(e?.breadcrumbs?.[0]?.message).toBe('POST com CNPJ [cnpj]');
    expect(e?.breadcrumbs?.[0]?.data).toBeUndefined();
  });
});

describe('opções', () => {
  it('não envia PII por padrão e fica inerte sem DSN', () => {
    expect(opcoesComuns.sendDefaultPii).toBe(false);
    // Nos testes não há NEXT_PUBLIC_SENTRY_DSN, então o Sentry não inicializa.
    expect(opcoesComuns.enabled).toBe(false);
  });
});
