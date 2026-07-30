import { describe, expect, it } from 'vitest';
import {
  CONVERSOES_POR_HORA,
  PLANOS,
  PLANO_PADRAO,
  conferirCota,
  conferirTamanho,
  ehPlano,
  limitesDe,
} from '@/lib/plans';

const MB = 1024 * 1024;

describe('PLANOS — os limites da spec 4.1', () => {
  it('bate com a tabela da spec', () => {
    expect(PLANOS.free).toMatchObject({
      conversoesPorMes: 3,
      tamanhoMaximoBytes: 5 * MB,
      retencaoDias: 1,
      precoMensalReais: 0,
    });
    expect(PLANOS.pro).toMatchObject({
      conversoesPorMes: 50,
      tamanhoMaximoBytes: 50 * MB,
      retencaoDias: 30,
      precoMensalReais: 79,
    });
    expect(PLANOS.escritorio).toMatchObject({
      conversoesPorMes: 500,
      tamanhoMaximoBytes: 200 * MB,
      retencaoDias: 90,
      precoMensalReais: 249,
    });
  });

  it('os nomes de plano sao os mesmos do check da tabela perfis', () => {
    // A migration declara check (plano in ('free','pro','escritorio')). Se
    // divergirem, o app grava valor que o banco recusa.
    expect(Object.keys(PLANOS).sort()).toEqual(['escritorio', 'free', 'pro']);
  });

  it('o padrao e o gratuito, igual ao default da coluna', () => {
    expect(PLANO_PADRAO).toBe('free');
  });

  it('o rate limit da spec 8 nao depende do plano', () => {
    expect(CONVERSOES_POR_HORA).toBe(10);
  });
});

describe('ehPlano / limitesDe', () => {
  it('aceita os tres planos', () => {
    expect(ehPlano('free')).toBe(true);
    expect(ehPlano('pro')).toBe(true);
    expect(ehPlano('escritorio')).toBe(true);
  });

  it('recusa qualquer outra coisa', () => {
    for (const valor of ['FREE', 'gratis', '', null, undefined, 42, {}, 'constructor']) {
      expect(ehPlano(valor)).toBe(false);
    }
  });

  it('valor invalido cai no plano mais restritivo, nao no mais permissivo', () => {
    // Se o dado do banco vier corrompido, o erro tem de ser negar demais.
    expect(limitesDe('plano_que_nao_existe')).toBe(PLANOS.free);
    expect(limitesDe(null)).toBe(PLANOS.free);
    expect(limitesDe(undefined)).toBe(PLANOS.free);
  });
});

describe('conferirCota', () => {
  it('permite enquanto sobra cota e conta o que resta', () => {
    expect(conferirCota('free', 0)).toEqual({ permitido: true, motivo: '', restantes: 3 });
    expect(conferirCota('free', 2)).toEqual({ permitido: true, motivo: '', restantes: 1 });
  });

  it('bloqueia exatamente no limite, nao depois', () => {
    const r = conferirCota('free', 3);
    expect(r.permitido).toBe(false);
    expect(r.restantes).toBe(0);
    expect(r.motivo).toContain('Gratuito');
    expect(r.motivo).toContain('3 conversões');
  });

  it('nao devolve restantes negativo se o contador passou do limite', () => {
    expect(conferirCota('free', 99).restantes).toBe(0);
  });

  it('respeita o limite de cada plano', () => {
    expect(conferirCota('pro', 49).permitido).toBe(true);
    expect(conferirCota('pro', 50).permitido).toBe(false);
    expect(conferirCota('escritorio', 499).permitido).toBe(true);
    expect(conferirCota('escritorio', 500).permitido).toBe(false);
  });
});

describe('conferirTamanho', () => {
  it('aceita exatamente no limite', () => {
    expect(conferirTamanho('free', 5 * MB).permitido).toBe(true);
    expect(conferirTamanho('pro', 50 * MB).permitido).toBe(true);
    expect(conferirTamanho('escritorio', 200 * MB).permitido).toBe(true);
  });

  it('recusa um byte acima e explica em MB', () => {
    const r = conferirTamanho('free', 5 * MB + 1);
    expect(r.permitido).toBe(false);
    expect(r.motivo).toContain('5 MB');
    expect(r.motivo).toContain('Gratuito');
  });

  it('formata o tamanho com virgula decimal, como o resto do produto', () => {
    const r = conferirTamanho('free', Math.round(7.5 * MB));
    expect(r.motivo).toContain('7,5 MB');
    expect(r.motivo).not.toContain('7.5');
  });

  it('o arquivo real de 17 MB nao cabe no gratuito, mas cabe no pro', () => {
    const dezesseteMb = 17_067_032;
    expect(conferirTamanho('free', dezesseteMb).permitido).toBe(false);
    expect(conferirTamanho('pro', dezesseteMb).permitido).toBe(true);
  });
});
