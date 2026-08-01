// Formatacao da interface. Ver lib/formato.ts.
import { describe, expect, it } from 'vitest';
import {
  formatarBytes,
  formatarCnpj,
  formatarData,
  formatarDuracao,
  formatarNumero,
  formatarPeriodo,
} from '@/lib/formato';

describe('formatarCnpj', () => {
  it('põe a máscara do CNPJ', () => {
    expect(formatarCnpj('39189437736165')).toBe('39.189.437/7361-65');
  });

  it('devolve o valor cru quando não tem 14 dígitos', () => {
    // CNPJ alfanumérico e valor truncado passam direto: inventar máscara aqui
    // esconderia dado errado do usuário.
    expect(formatarCnpj('123')).toBe('123');
    expect(formatarCnpj(null)).toBe('');
    expect(formatarCnpj(undefined)).toBe('');
  });

  it('ignora pontuação já presente', () => {
    expect(formatarCnpj('39.189.437/7361-65')).toBe('39.189.437/7361-65');
  });
});

describe('formatarData e formatarPeriodo', () => {
  it('inverte a data ISO para o formato brasileiro', () => {
    expect(formatarData('2021-12-01')).toBe('01/12/2021');
    expect(formatarData('2021-12-01T00:00:00Z')).toBe('01/12/2021');
    expect(formatarData(null)).toBe('');
  });

  it('compacta o período quando começa e termina no mesmo mês', () => {
    // É como o contador fala: "a escrituração de 12/2021".
    expect(formatarPeriodo('2021-12-01', '2021-12-31')).toBe('12/2021');
  });

  it('mostra os dois extremos quando cruza meses', () => {
    expect(formatarPeriodo('2021-11-01', '2021-12-31')).toBe('01/11/2021 a 31/12/2021');
  });

  it('aguenta período incompleto', () => {
    expect(formatarPeriodo('2021-12-01', null)).toBe('01/12/2021');
    expect(formatarPeriodo(null, null)).toBe('');
  });
});

describe('formatarBytes', () => {
  it('escolhe a unidade e usa vírgula decimal', () => {
    expect(formatarBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatarBytes(1536)).toBe('1,5 KB');
    expect(formatarBytes(900)).toBe('900 B');
    expect(formatarBytes(0)).toBe('0 B');
  });

  it('não passa de GB', () => {
    expect(formatarBytes(5 * 1024 ** 4)).toContain('GB');
  });
});

describe('formatarNumero e formatarDuracao', () => {
  it('separa milhar com ponto', () => {
    expect(formatarNumero(138100)).toBe('138.100');
  });

  it('mostra ms abaixo de um segundo e s acima', () => {
    expect(formatarDuracao(120)).toBe('120 ms');
    expect(formatarDuracao(35600)).toBe('35,6 s');
    expect(formatarDuracao(null)).toBe('');
  });
});
