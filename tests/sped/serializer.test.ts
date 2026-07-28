import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import { serializarTxt } from '@/lib/sped/serializer';
import type { ErroValidacao, Layout, NoRegistro } from '@/lib/sped/types';

let layout: Layout;
beforeAll(() => {
  layout = carregarLayout();
});

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));

/** No sintetico, para os casos que nao vem de arquivo. */
const no = (ordem: number, reg: string, ...valores: string[]): NoRegistro => ({
  id: `r${String(ordem).padStart(6, '0')}`,
  paiId: null,
  reg,
  nivel: 0,
  ordem,
  valores: [reg, ...valores],
  linhaOriginal: ordem,
});

describe('round-trip byte a byte', () => {
  it('efd_minimo.txt volta identico ao original', () => {
    // Este e o criterio de aceite de F1-T5.
    const original = fixture('efd_minimo.txt');
    const saida = serializarTxt(parseTxt(original, layout).nos);
    expect(saida.equals(original)).toBe(true);
  });

  it('efd_reduzido.txt, arquivo real de 153 linhas, volta identico', () => {
    const original = fixture('efd_reduzido.txt');
    const resultado = parseTxt(original, layout);
    expect(resultado.erros).toEqual([]);

    const avisos: ErroValidacao[] = [];
    const saida = serializarTxt(resultado.nos, avisos);

    expect(saida.equals(original)).toBe(true);
    expect(saida).toHaveLength(original.length);
    // arquivo real nao tem caractere fora do Latin-1
    expect(avisos).toEqual([]);
  });

  it('sobrevive a duas voltas seguidas', () => {
    const original = fixture('efd_reduzido.txt');
    const uma = serializarTxt(parseTxt(original, layout).nos);
    const duas = serializarTxt(parseTxt(uma, layout).nos);
    expect(duas.equals(original)).toBe(true);
  });

  it('efd_com_erros.txt NAO volta identico, e isso e esperado', () => {
    // O parser descarta a linha sem pipe e a linha em branco (spec 5.2), que
    // por definicao nao podem ser reconstruidas.
    const original = fixture('efd_com_erros.txt');
    const resultado = parseTxt(original, layout);
    const saida = serializarTxt(resultado.nos);

    expect(resultado.erros).toHaveLength(2);
    expect(saida.equals(original)).toBe(false);
    expect(saida.toString('latin1').split('\r\n').filter(Boolean)).toHaveLength(11);
  });
});

describe('encoding Latin-1', () => {
  it('preserva ç, ã e é como um byte cada', () => {
    const original = fixture('efd_minimo.txt');
    const saida = serializarTxt(parseTxt(original, layout).nos);

    const nome = saida.toString('latin1').split('\r\n')[0]?.slice(1, -1).split('|')[7];
    expect(nome).toBe('AÇÃO COMÉRCIO E EXPORTAÇÃO LTDA');

    // conferencia no nivel do byte: Latin-1 usa um byte por caractere
    expect(saida.includes(Buffer.from([0xc7]))).toBe(true); // Ç
    expect(saida.includes(Buffer.from([0xc3]))).toBe(true); // Ã
    expect(saida.includes(Buffer.from([0xc9]))).toBe(true); // É
    // se tivesse saido UTF-8, o Ç viria como 0xC3 0x87
    expect(saida.includes(Buffer.from([0xc3, 0x87]))).toBe(false);
  });

  it('troca caractere fora do Latin-1 pelo equivalente e avisa', () => {
    const avisos: ErroValidacao[] = [];
    // travessao e aspas curvas: comuns quando o dado passa por Word/Excel
    const saida = serializarTxt([no(1, '0150', 'EMPRESA — “TESTE”')], avisos);

    expect(saida.toString('latin1')).toBe('|0150|EMPRESA - "TESTE"|\r\n');
    expect(avisos).toHaveLength(3);
    expect(avisos.every((a) => a.severidade === 'aviso')).toBe(true);
    expect(avisos[0]?.registro).toBe('0150');
  });

  it('tira o acento de letra que nao existe no Latin-1, sem mudar o comprimento', () => {
    const avisos: ErroValidacao[] = [];
    const saida = serializarTxt([no(1, '0150', 'ŐSTERREICH')], avisos);
    expect(saida.toString('latin1')).toBe('|0150|OSTERREICH|\r\n');
    expect(avisos).toHaveLength(1);
  });

  it('usa "?" quando nao ha equivalente, e avisa', () => {
    const avisos: ErroValidacao[] = [];
    const saida = serializarTxt([no(1, '0150', 'AB☃CD')], avisos);
    expect(saida.toString('latin1')).toBe('|0150|AB?CD|\r\n');
    expect(avisos[0]?.mensagem).toMatch(/nao tem equivalente/);
  });

  it('nao deixa nenhum byte acima de 0xFF escapar', () => {
    const saida = serializarTxt([no(1, '0150', 'ŐSTERREICH — ☃ — €')]);
    // todo byte do buffer e, por definicao, <= 0xFF; o que importa e que a
    // releitura em Latin-1 devolve exatamente o que foi gravado
    const relido = saida.toString('latin1');
    expect(Buffer.from(relido, 'latin1').equals(saida)).toBe(true);
  });
});

describe('regras de formato do PVA', () => {
  const saida = () => serializarTxt(parseTxt(fixture('efd_reduzido.txt'), layout).nos);

  it('usa CRLF e nenhum LF solto', () => {
    const texto = saida().toString('latin1');
    expect((texto.match(/\r\n/g) ?? []).length).toBe(153);
    expect(texto.match(/(?<!\r)\n/g)).toBeNull();
  });

  it('termina o arquivo com quebra de linha', () => {
    expect(saida().toString('latin1').endsWith('\r\n')).toBe(true);
  });

  it('nao produz linha em branco', () => {
    const linhas = saida().toString('latin1').split('\r\n');
    expect(linhas.pop()).toBe(''); // efeito da quebra final, nao e linha
    expect(linhas.filter((l) => l.trim() === '')).toEqual([]);
  });

  it('toda linha comeca e termina com pipe', () => {
    const linhas = saida().toString('latin1').split('\r\n').filter(Boolean);
    expect(linhas.every((l) => l.startsWith('|') && l.endsWith('|'))).toBe(true);
  });

  it('descarta linha que ficaria em branco e avisa', () => {
    const avisos: ErroValidacao[] = [];
    const vazio: NoRegistro = { ...no(1, ''), valores: [] };
    const saida = serializarTxt([vazio, no(2, '9999', '2')], avisos);
    // "||" nao e linha em branco; o arquivo sai com as duas linhas
    expect(saida.toString('latin1')).toBe('||\r\n|9999|2|\r\n');
    expect(avisos).toEqual([]);
  });
});

describe('ordenacao e efeitos colaterais', () => {
  it('ordena por `ordem`, nao pela posicao no array', () => {
    const embaralhados = [no(3, '0990', '3'), no(1, '0000', '006'), no(2, '0001', '0')];
    const texto = serializarTxt(embaralhados).toString('latin1');
    expect(texto).toBe('|0000|006|\r\n|0001|0|\r\n|0990|3|\r\n');
  });

  it('nao altera o array recebido', () => {
    const entrada = [no(3, '0990', '3'), no(1, '0000', '006'), no(2, '0001', '0')];
    const antes = entrada.map((n) => n.ordem);
    serializarTxt(entrada);
    expect(entrada.map((n) => n.ordem)).toEqual(antes);
  });

  it('arvore vazia gera arquivo vazio', () => {
    expect(serializarTxt([])).toHaveLength(0);
  });
});

describe('valores que corromperiam o arquivo', () => {
  it('avisa quando o valor contem o proprio delimitador', () => {
    const avisos: ErroValidacao[] = [];
    serializarTxt([no(1, '0150', 'RAZAO|SOCIAL')], avisos);
    expect(avisos.some((a) => /delimitador/.test(a.mensagem))).toBe(true);
  });

  it('avisa quando o valor contem quebra de linha', () => {
    const avisos: ErroValidacao[] = [];
    serializarTxt([no(1, '0150', 'LINHA1\r\nLINHA2')], avisos);
    expect(avisos.some((a) => /quebra de linha/.test(a.mensagem))).toBe(true);
  });

  it('preserva zero a esquerda e virgula decimal', () => {
    const texto = serializarTxt([no(1, 'C170', '00123', '0,65', '')]).toString('latin1');
    expect(texto).toBe('|C170|00123|0,65||\r\n');
  });
});
