// Teste de fumaca do scaffolding (tarefa F1-T1).
// Substituido pelos testes reais do loader em F1-T2.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('esqueleto do projeto', () => {
  it('o dicionario de leiaute esta presente e declara 192 registros', () => {
    const bruto = readFileSync(
      join(process.cwd(), 'data', 'layout_efd_contribuicoes.json'),
      'utf-8',
    );
    const dicionario = JSON.parse(bruto) as {
      layout: string;
      versao_guia: string;
      total_registros: number;
      registros: Record<string, unknown>;
    };

    expect(dicionario.layout).toBe('EFD-Contribuicoes');
    expect(dicionario.versao_guia).toBe('1.35');
    expect(dicionario.total_registros).toBe(192);
    expect(Object.keys(dicionario.registros)).toHaveLength(192);
  });
});
