// F2-T3 — teste de ouro. Ver docs/SPEC.md secao 9.2.
//
// O ciclo completo TXT -> AST -> XLSX -> AST -> totalizadores -> TXT tem de
// devolver o arquivo original byte a byte quando nao houve edicao. Qualquer
// divergencia aponta bug em totalizadores, ordenacao ou encoding.
//
// A spec chama este de o teste mais importante do projeto, e ele e o unico
// que exercita os cinco modulos juntos.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { recalcularBasesDeCredito } from '@/lib/sped/apuracao';
import { lerExcel } from '@/lib/sped/from-excel';
import { carregarLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import { serializarTxt } from '@/lib/sped/serializer';
import { gerarExcel } from '@/lib/sped/to-excel';
import { recalcularTotalizadores } from '@/lib/sped/totalizers';
import type { Layout } from '@/lib/sped/types';

let layout: Layout;
beforeAll(() => {
  layout = carregarLayout();
});

const caminho = (nome: string) => join(process.cwd(), 'tests', 'fixtures', nome);

/**
 * O ciclo inteiro, exatamente como a spec 9.2 escreve, mais o recalculo da
 * base de credito, que entrou no pipeline depois (ver lib/sped/apuracao.ts).
 * Sem edicao ele nao pode alterar um byte — e este teste e quem trava isso.
 */
async function idaEVolta(original: Buffer) {
  const ast = parseTxt(original, layout);
  const xlsx = await gerarExcel(ast, layout);
  const volta = await lerExcel(xlsx, layout);
  const apuracao = recalcularBasesDeCredito(volta.nos, volta.atribuicao ?? null);
  const saida = serializarTxt(recalcularTotalizadores(apuracao.nos));
  return { ast, volta, saida, apuracao };
}

describe('teste de ouro — round-trip completo', () => {
  it('efd_minimo.txt volta byte a byte', async () => {
    const original = readFileSync(caminho('efd_minimo.txt'));
    const { ast, volta, saida, apuracao } = await idaEVolta(original);

    expect(volta.erros).toEqual([]);
    expect(apuracao.erros).toEqual([]);
    expect(volta.nos).toHaveLength(ast.nos.length);
    expect(saida.equals(original)).toBe(true);
  });

  it('efd_reduzido.txt, arquivo real com os 74 tipos de registro, volta byte a byte', async () => {
    const original = readFileSync(caminho('efd_reduzido.txt'));
    const { ast, volta, saida, apuracao } = await idaEVolta(original);

    expect(volta.erros).toEqual([]);
    // A apuracao pode avisar que a base nao fechava (a fixture tem valores
    // embaralhados pelo anonimizador), mas nunca pode ERRAR nem alterar bytes.
    expect(apuracao.erros).toEqual([]);
    expect(volta.nos).toHaveLength(ast.nos.length);
    expect(saida).toHaveLength(original.length);
    expect(saida.equals(original)).toBe(true);
  });

  it('preserva zero a esquerda e virgula decimal em todo o caminho', async () => {
    const original = readFileSync(caminho('efd_reduzido.txt'));
    const { ast, volta } = await idaEVolta(original);

    const achatar = (nos: typeof ast.nos) => nos.flatMap((n) => n.valores);
    const antes = achatar(ast.nos);
    const depois = achatar(volta.nos);

    expect(depois).toEqual(antes);
    // e havia o que preservar: se estes numeros zerarem, o teste perdeu sentido
    expect(antes.filter((v) => /^0\d/.test(v)).length).toBeGreaterThan(50);
    expect(antes.filter((v) => v.includes(',')).length).toBeGreaterThan(50);
  });

  it('preserva a acentuacao Latin-1 pelo ciclo inteiro', async () => {
    const original = readFileSync(caminho('efd_minimo.txt'));
    const { saida } = await idaEVolta(original);

    expect(saida.toString('latin1')).toContain('AÇÃO COMÉRCIO E EXPORTAÇÃO LTDA');
    // um byte por caractere; se tivesse virado UTF-8, o Ç seria 0xC3 0x87
    expect(saida.includes(Buffer.from([0xc7]))).toBe(true);
    expect(saida.includes(Buffer.from([0xc3, 0x87]))).toBe(false);
  });

  it('duas voltas seguidas continuam identicas', async () => {
    const original = readFileSync(caminho('efd_reduzido.txt'));
    const uma = (await idaEVolta(original)).saida;
    const duas = (await idaEVolta(uma)).saida;
    expect(duas.equals(original)).toBe(true);
  });

  it('o arquivo real de 138.100 linhas volta byte a byte', async () => {
    // Sao 17 MB e o arquivo fica fora do repo (.gitignore), entao o teste se
    // pula quando ele nao esta na maquina. E a prova mais forte que existe
    // aqui: 3,2 milhoes de celulas passando pelo Excel e voltando.
    const alvo = caminho('efd_real_validado.txt');
    if (!existsSync(alvo)) return;

    const original = readFileSync(alvo);
    const { ast, volta, saida } = await idaEVolta(original);

    expect(ast.nos).toHaveLength(138100);
    expect(volta.erros).toEqual([]);
    expect(volta.nos).toHaveLength(138100);
    expect(saida.equals(original)).toBe(true);
  }, 180_000);
});
