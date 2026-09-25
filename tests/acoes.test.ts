// mensagemDeRateLimit: traduz o rate limit de e-mail do GoTrue (B2). O resto
// de cadastrar()/reenviarConfirmacao() fala com o Supabase de verdade e é
// verificado ao vivo, como o cadastro/login (F3-T2) — ver
// docs/BUGS-POS-DEPLOY.md.
import { describe, expect, it } from 'vitest';
import { mensagemDeRateLimit } from '@/app/(auth)/rate-limit';

describe('mensagemDeRateLimit', () => {
  it('traduz a contagem regressiva por e-mail (60s)', () => {
    expect(
      mensagemDeRateLimit('For security purposes, you can only request this after 52 seconds.'),
    ).toBe('Aguarde 52 segundos antes de tentar de novo.');
  });

  it('traduz mesmo no singular, "1 second"', () => {
    expect(mensagemDeRateLimit('you can only request this after 1 second.')).toBe(
      'Aguarde 1 segundos antes de tentar de novo.',
    );
  });

  it('traduz o teto por hora do projeto, sem contagem embutida', () => {
    expect(mensagemDeRateLimit('email rate limit exceeded')).toBe(
      'Muitas tentativas nesta hora. Aguarde um pouco antes de tentar de novo.',
    );
  });

  it('devolve null para mensagem sem relação com rate limit', () => {
    expect(mensagemDeRateLimit('User not found')).toBeNull();
    expect(mensagemDeRateLimit('Invalid login credentials')).toBeNull();
  });
});
