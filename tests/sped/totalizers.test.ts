// Testes de F1-T6, escritos ANTES da implementacao.
//
// A semantica aqui nao foi deduzida da spec: foi MEDIDA contra dois
// arquivos reais aprovados pelo PVA. O de 138.100 linhas tem 74 tipos de
// registro e 74 linhas de 9900, com a propria 9900 declarando 74 — logo o
// 9900 se conta. E o 9990 declara 77 = 9001 + 74x9900 + 9990 + 9999.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import { serializarTxt } from '@/lib/sped/serializer';
import { recalcularTotalizadores } from '@/lib/sped/totalizers';
import type { Layout, NoRegistro } from '@/lib/sped/types';

let layout: Layout;
beforeAll(() => {
  layout = carregarLayout();
});

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));
const txt = (...linhas: string[]) => Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1');

/** Le linhas soltas e devolve a arvore, como o parser faria. */
const arvore = (...linhas: string[]): NoRegistro[] => parseTxt(txt(...linhas), layout).nos;

/** Reduz a arvore a linhas de texto, para comparar sem ruido. */
const linhas = (nos: NoRegistro[]): string[] =>
  [...nos].sort((a, b) => a.ordem - b.ordem).map((n) => `|${n.valores.join('|')}|`);

/** Valor do campo N (1-based) do primeiro no do tipo pedido. */
const campo = (nos: NoRegistro[], reg: string, num: number): string | undefined =>
  nos.find((n) => n.reg === reg)?.valores[num - 1];

const contar = (nos: NoRegistro[], reg: string) => nos.filter((n) => n.reg === reg).length;

describe('recalcularTotalizadores — as quatro regras da spec 5.5', () => {
  it('X990 conta a propria linha de encerramento', () => {
    // bloco C com 3 linhas de conteudo + a C990 = 4
    const saida = recalcularTotalizadores(
      arvore('|0000|006|', '|C001|0|', '|C010|1|1|', '|C100|x|'),
    );
    expect(campo(saida, 'C990', 2)).toBe('4');
  });

  it('9900 conta a si mesmo entre os tipos', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|0001|0|'));
    const tipos = new Set(saida.map((n) => n.reg));
    // uma linha 9900 por tipo presente
    expect(contar(saida, '9900')).toBe(tipos.size);
    // e a linha do proprio 9900 declara esse mesmo total
    const doProprio = saida.find((n) => n.reg === '9900' && n.valores[1] === '9900');
    expect(doProprio?.valores[2]).toBe(String(tipos.size));
  });

  it('9990 conta todas as linhas do bloco 9, incluindo ela mesma e a 9999', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|0001|0|'));
    const doBloco9 = saida.filter((n) => n.reg.startsWith('9'));
    expect(campo(saida, '9990', 2)).toBe(String(doBloco9.length));
    // conferencia explicita: 9900s + a 9990 + a 9999
    expect(doBloco9.length).toBe(contar(saida, '9900') + 2);
  });

  it('9999 e o total de linhas do arquivo', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|0001|0|', '|C001|0|'));
    expect(campo(saida, '9999', 2)).toBe(String(saida.length));
  });
});

describe('recalcularTotalizadores — casos exigidos por F1-T6', () => {
  it('arquivo minimo: totalizadores ja corretos saem identicos', () => {
    // Criterio explicito da tarefa. efd_minimo.txt foi montado com os
    // totalizadores certos, entao recalcular nao pode mudar nada.
    const original = fixture('efd_minimo.txt');
    const antes = parseTxt(original, layout).nos;
    const depois = recalcularTotalizadores(antes);
    expect(linhas(depois)).toEqual(linhas(antes));
    expect(serializarTxt(depois).equals(original)).toBe(true);
  });

  it('arquivo real com todos os blocos sai identico', () => {
    const original = fixture('efd_reduzido.txt');
    const antes = parseTxt(original, layout).nos;
    const depois = recalcularTotalizadores(antes);
    expect(linhas(depois)).toEqual(linhas(antes));
    expect(serializarTxt(depois).equals(original)).toBe(true);
  });

  it('bloco vazio: so a abertura e o encerramento, X990 = 2', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|A001|1|'));
    expect(campo(saida, 'A990', 2)).toBe('2');
  });

  it('registro de ocorrencia unica conta 1', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|0001|0|'));
    const do0000 = saida.find((n) => n.reg === '9900' && n.valores[1] === '0000');
    expect(do0000?.valores[2]).toBe('1');
  });

  it('registro repetido conta a quantidade certa', () => {
    const saida = recalcularTotalizadores(
      arvore('|0000|006|', '|C001|0|', '|C010|1|', '|C010|2|', '|C010|3|'),
    );
    const doC010 = saida.find((n) => n.reg === '9900' && n.valores[1] === 'C010');
    expect(doC010?.valores[2]).toBe('3');
  });
});

describe('recalcularTotalizadores — corrige o que estiver errado', () => {
  it('conserta totalizador com valor errado', () => {
    const saida = recalcularTotalizadores(
      arvore('|0000|006|', '|0001|0|', '|0990|999|', '|9999|12345|'),
    );
    expect(campo(saida, '0990', 2)).toBe('3'); // 0000 + 0001 + 0990
    expect(campo(saida, '9999', 2)).toBe(String(saida.length));
  });

  it('cria totalizador que nao existia', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|C001|0|'));
    expect(contar(saida, '0990')).toBe(1);
    expect(contar(saida, 'C990')).toBe(1);
    expect(contar(saida, '9990')).toBe(1);
    expect(contar(saida, '9999')).toBe(1);
  });

  it('descarta 9900 sobrando, inclusive de registro que nao existe mais', () => {
    const saida = recalcularTotalizadores(
      arvore('|0000|006|', '|9900|XXXX|99|', '|9900|0000|1|', '|9900|0000|1|'),
    );
    expect(saida.some((n) => n.reg === '9900' && n.valores[1] === 'XXXX')).toBe(false);
    // uma linha 9900 por tipo, sem repetir
    const citados = saida.filter((n) => n.reg === '9900').map((n) => n.valores[1]);
    expect(citados.length).toBe(new Set(citados).size);
  });

  it('nao deixa X990 duplicado', () => {
    const saida = recalcularTotalizadores(
      arvore('|0000|006|', '|C001|0|', '|C990|7|', '|C990|8|'),
    );
    expect(contar(saida, 'C990')).toBe(1);
  });
});

describe('recalcularTotalizadores — estrutura do resultado', () => {
  it('mantem a ordem dos blocos e poe o bloco 9 no fim', () => {
    const saida = recalcularTotalizadores(
      arvore('|0000|006|', '|A001|0|', '|C001|0|', '|M001|0|'),
    );
    const blocos = linhas(saida).map((l) => l[1]);
    const primeiraVez = [...new Set(blocos)];
    expect(primeiraVez).toEqual(['0', 'A', 'C', 'M', '9']);
    expect(saida[saida.length - 1]?.reg).toBe('9999');
  });

  it('renumera `ordem` de 1 a N sem buraco', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|C001|0|'));
    const ordens = [...saida].sort((a, b) => a.ordem - b.ordem).map((n) => n.ordem);
    expect(ordens).toEqual(ordens.map((_, i) => i + 1));
  });

  it('todo no tem id unico', () => {
    const saida = recalcularTotalizadores(arvore('|0000|006|', '|C001|0|', '|C010|1|'));
    const ids = saida.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nao altera o array recebido', () => {
    const entrada = arvore('|0000|006|', '|0001|0|');
    const copia = linhas(entrada);
    const tamanho = entrada.length;
    recalcularTotalizadores(entrada);
    expect(entrada).toHaveLength(tamanho);
    expect(linhas(entrada)).toEqual(copia);
  });

  it('e idempotente: recalcular duas vezes da o mesmo', () => {
    const uma = recalcularTotalizadores(arvore('|0000|006|', '|C001|0|', '|C010|1|'));
    const duas = recalcularTotalizadores(uma);
    expect(linhas(duas)).toEqual(linhas(uma));
  });

  it('arvore vazia devolve arvore vazia', () => {
    expect(recalcularTotalizadores([])).toEqual([]);
  });
});

describe('recalcularTotalizadores — ordem das linhas 9900', () => {
  // A ordem em que o 9900 cita os registros NAO vem da spec: e convencao de
  // quem gerou o arquivo. No arquivo real aprovado pelo PVA ela nao e a
  // ordem de aparicao — o C120 e citado entre C100 e C170, embora apareca
  // fisicamente depois do C505, e a entrada do proprio 9900 vem por ultimo,
  // depois da 9990 e da 9999. Impor ordem propria inviabiliza o round-trip
  // byte a byte de arquivo de terceiro.

  it('preserva a ordem que o arquivo declarou, mesmo fora da ordem de aparicao', () => {
    const entrada = arvore(
      '|0000|006|',
      '|C001|0|',
      '|C170|1|',
      '|C120|1|', // aparece DEPOIS do C170...
      '|9900|C120|1|', // ...mas o arquivo declara ANTES
      '|9900|C170|1|',
    );
    const citados = recalcularTotalizadores(entrada)
      .filter((n) => n.reg === '9900')
      .map((n) => n.valores[1]);
    expect(citados.indexOf('C120')).toBeLessThan(citados.indexOf('C170'));
  });

  it('poe a entrada do proprio 9900 onde o arquivo a colocou', () => {
    // Todos os tipos declarados, como em arquivo de verdade: o arquivo real
    // aprovado pelo PVA cita o proprio 9900 por ultimo, depois da 9990 e da
    // 9999, e nao em ordem de codigo.
    const entrada = arvore(
      '|0000|006|',
      '|0990|2|',
      '|9900|0000|1|',
      '|9900|0990|1|',
      '|9900|9990|1|',
      '|9900|9999|1|',
      '|9900|9900|5|',
      '|9990|7|',
      '|9999|9|',
    );
    const citados = recalcularTotalizadores(entrada)
      .filter((n) => n.reg === '9900')
      .map((n) => n.valores[1]);
    expect(citados).toEqual(['0000', '0990', '9990', '9999', '9900']);
  });

  it('acrescenta tipo novo no fim e descarta tipo que sumiu', () => {
    const entrada = arvore(
      '|0000|006|',
      '|C001|0|', // tipo novo: nao esta na ordem declarada
      '|9900|SUMIU|3|', // tipo que nao existe mais
      '|9900|0000|1|',
    );
    const citados = recalcularTotalizadores(entrada)
      .filter((n) => n.reg === '9900')
      .map((n) => n.valores[1]);
    expect(citados).not.toContain('SUMIU');
    expect(citados[0]).toBe('0000');
    expect(citados).toContain('C001');
  });

  it('sem 9900 na entrada, usa a ordem de aparicao da spec 5.5', () => {
    const citados = recalcularTotalizadores(arvore('|0000|006|', '|A001|0|', '|C001|0|'))
      .filter((n) => n.reg === '9900')
      .map((n) => n.valores[1]);
    // cada bloco seguido do proprio encerramento, na ordem em que aparecem
    expect(citados.slice(0, 6)).toEqual(['0000', '0990', 'A001', 'A990', 'C001', 'C990']);
  });

  it('bloco fora da ordem canonica e preservado, nao reordenado', () => {
    // Reordenar seria alterar o arquivo do usuario por conta propria.
    // Apontar bloco fora de ordem cabe ao validador de F1-T7.
    const citados = recalcularTotalizadores(arvore('|0000|006|', '|C001|0|', '|A001|0|'))
      .filter((n) => n.reg === '9900')
      .map((n) => n.valores[1]);
    expect(citados.slice(0, 6)).toEqual(['0000', '0990', 'C001', 'C990', 'A001', 'A990']);
  });
});

describe('recalcularTotalizadores — contraprova independente', () => {
  it('bate com os totalizadores que o redutor de fixture calculou', () => {
    // scripts/reduz_fixture.mjs calcula os mesmos numeros por outro caminho
    // e foi escrito antes deste modulo. A fixture reduzida e a saida dele,
    // entao recalcular sobre ela tem de reproduzir exatamente os mesmos
    // valores — se divergir, uma das duas implementacoes esta errada.
    const nos = parseTxt(fixture('efd_reduzido.txt'), layout).nos;
    const saida = recalcularTotalizadores(nos);

    expect(campo(saida, '9999', 2)).toBe('153');
    expect(campo(saida, '9990', 2)).toBe('77');
    expect(contar(saida, '9900')).toBe(74);
    const doProprio = saida.find((n) => n.reg === '9900' && n.valores[1] === '9900');
    expect(doProprio?.valores[2]).toBe('74');
  });

  it('reproduz os totalizadores do arquivo real de 138.100 linhas', () => {
    // A prova mais forte que existe neste projeto: o pipeline completo sobre
    // um arquivo aprovado pelo PVA tem de devolver os MESMOS totalizadores,
    // byte a byte. O arquivo tem 17 MB e fica fora do repo (ver .gitignore),
    // entao o teste se pula quando ele nao esta na maquina.
    const caminho = join(process.cwd(), 'tests', 'fixtures', 'efd_real_validado.txt');
    if (!existsSync(caminho)) return;

    const original = readFileSync(caminho);
    const nos = parseTxt(original, layout).nos;
    expect(nos).toHaveLength(138100);
    expect(serializarTxt(recalcularTotalizadores(nos)).equals(original)).toBe(true);
  });

  it('preserva o bloco I, que nao esta no dicionario', () => {
    // I001/I990 aparecem em arquivo real e o bloco I tem leiaute em ADE
    // separado. O recalculo nao pode descartar nem errar o I990.
    const saida = recalcularTotalizadores(parseTxt(fixture('efd_reduzido.txt'), layout).nos);
    expect(contar(saida, 'I001')).toBe(1);
    expect(contar(saida, 'I990')).toBe(1);
  });
});
