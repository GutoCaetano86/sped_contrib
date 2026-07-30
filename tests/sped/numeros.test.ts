// Aritmetica decimal exata. Ver lib/sped/numeros.ts.
import { describe, expect, it } from 'vitest';
import { ESCALA, casasDecimais, formatarDecimal, paraDecimal, somar } from '@/lib/sped/numeros';

describe('paraDecimal', () => {
  it('le o formato do leiaute: virgula decimal, sem milhar', () => {
    expect(paraDecimal('1234,56')).toBe(123456000000n);
    expect(paraDecimal('0,65')).toBe(65000000n);
    expect(paraDecimal('100')).toBe(10000000000n);
  });

  it('tolera ponto de milhar, que a planilha reformatada cria', () => {
    expect(paraDecimal('1.234,56')).toBe(paraDecimal('1234,56'));
    expect(paraDecimal('169.187.549,36')).toBe(paraDecimal('169187549,36'));
  });

  it('vazio, espaco e lixo viram zero, sem lancar', () => {
    for (const entrada of ['', '   ', undefined, 'abc', '1,2,3']) {
      expect(paraDecimal(entrada)).toBe(0n);
    }
  });

  it('preserva as 4 casas da aliquota', () => {
    expect(formatarDecimal(paraDecimal('1,6500'), 4)).toBe('1,6500');
    expect(formatarDecimal(paraDecimal('0,0001'), 4)).toBe('0,0001');
  });

  it('aceita negativo', () => {
    expect(paraDecimal('-6682,59')).toBe(-668259000000n);
    expect(formatarDecimal(paraDecimal('-6682,59'))).toBe('-6682,59');
  });
});

describe('somar — o motivo de o modulo existir', () => {
  it('soma 34 mil centavos sem perder um centavo', () => {
    // Em ponto flutuante esta soma erra: 0.07 nao tem representacao binaria
    // exata, e o PVA compara o total com igualdade.
    const parcelas = Array.from({ length: 34_758 }, () => paraDecimal('0,07'));
    expect(formatarDecimal(somar(parcelas))).toBe('2433,06');

    // O mesmo em ponto flutuante nao chega ao valor exato: 0,07 nao tem
    // representacao binaria finita e o erro se acumula parcela a parcela.
    const emFloat = Array.from({ length: 34_758 }, () => 0.07).reduce((a, b) => a + b, 0);
    expect(emFloat).not.toBe(2433.06);
  });

  it('reproduz a diferenca que o PVA cobrou', () => {
    const declarado = paraDecimal('169187549,36');
    const esperado = paraDecimal('169180866,77');
    expect(formatarDecimal(declarado - esperado)).toBe('6682,59');
  });
});

describe('formatarDecimal', () => {
  it('arredonda meio para cima em modulo', () => {
    expect(formatarDecimal(paraDecimal('1,005'), 2)).toBe('1,01');
    expect(formatarDecimal(paraDecimal('-1,005'), 2)).toBe('-1,01');
    expect(formatarDecimal(paraDecimal('1,004'), 2)).toBe('1,00');
  });

  it('completa as casas com zero a direita', () => {
    expect(formatarDecimal(paraDecimal('136540291,4'), 2)).toBe('136540291,40');
  });

  it('sem casas nao deixa virgula solta', () => {
    expect(formatarDecimal(paraDecimal('10,4'), 0)).toBe('10');
  });

  it('zero negativo sai sem sinal', () => {
    expect(formatarDecimal(paraDecimal('-0,001'), 2)).toBe('0,00');
  });

  it('a escala interna cobre a aliquota com folga', () => {
    expect(ESCALA).toBeGreaterThanOrEqual(4);
  });
});

describe('casasDecimais', () => {
  it('conta o que o arquivo declarou, para nao mexer em byte a toa', () => {
    // O arquivo real grava "136540291,4" com uma casa so.
    expect(casasDecimais('136540291,4')).toBe(1);
    expect(casasDecimais('0,65')).toBe(2);
    expect(casasDecimais('1,6500')).toBe(4);
    expect(casasDecimais('100')).toBe(0);
    expect(casasDecimais(undefined)).toBe(0);
  });
});
