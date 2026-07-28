import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import type { Layout } from '@/lib/sped/types';

let layout: Layout;
beforeAll(() => {
  layout = carregarLayout();
});

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));
/** Monta um TXT em Latin-1 com CRLF, como o arquivo real. */
const txt = (...linhas: string[]) => Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1');

describe('parseTxt — linha bem-formada', () => {
  it('quebra os campos sem os pipes das pontas', () => {
    const r = parseTxt(txt('|0001|0|'), layout);
    expect(r.erros).toEqual([]);
    expect(r.nos).toHaveLength(1);
    expect(r.nos[0]).toMatchObject({
      reg: '0001',
      valores: ['0001', '0'],
      ordem: 1,
      linhaOriginal: 1,
      nivel: 1,
    });
  });

  it('preserva o valor exatamente como veio', () => {
    // Zero a esquerda e significativo (CNPJ, CPF, codigos) e nao pode ser
    // normalizado; espaco tambem nao pode ser aparado.
    const r = parseTxt(txt('|0150|00123|  ESPACO  |0,65||'), layout);
    expect(r.nos[0]?.valores).toEqual(['0150', '00123', '  ESPACO  ', '0,65', '']);
  });

  it('le acento em Latin-1', () => {
    const r = parseTxt(fixture('efd_minimo.txt'), layout);
    expect(r.nos[0]?.valores[7]).toBe('AÇÃO COMÉRCIO E EXPORTAÇÃO LTDA');
  });

  it('aceita arquivo terminado com CRLF sem inventar linha em branco', () => {
    const r = parseTxt(txt('|0001|0|'), layout);
    expect(r.nos).toHaveLength(1);
    expect(r.erros).toEqual([]);
  });

  it('aceita LF sozinho como quebra de linha na leitura', () => {
    // O PVA exige CRLF na saida, mas a leitura nao pode falhar por isso.
    const r = parseTxt(Buffer.from('|0001|0|\n|0990|2|\n', 'latin1'), layout);
    expect(r.nos).toHaveLength(2);
  });
});

describe('parseTxt — linha sem pipe inicial', () => {
  it('registra erro e segue para a proxima linha', () => {
    const r = parseTxt(txt('|0001|0|', '0990|2|', '|9999|3|'), layout);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatchObject({ severidade: 'erro', linha: 2 });
    expect(r.erros[0]?.mensagem).toMatch(/pipe|"\|"/i);
    // as demais linhas continuam sendo lidas
    expect(r.nos.map((n) => n.reg)).toEqual(['0001', '9999']);
  });

  it('tambem pega linha sem o pipe final', () => {
    const r = parseTxt(txt('|0001|0'), layout);
    expect(r.erros).toHaveLength(1);
    expect(r.nos).toHaveLength(0);
  });
});

describe('parseTxt — linha vazia no meio do arquivo', () => {
  it('registra erro, porque o PVA recusa arquivo com linha em branco', () => {
    const r = parseTxt(txt('|0001|0|', '', '|9999|3|'), layout);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatchObject({ severidade: 'erro', linha: 2 });
    expect(r.nos.map((n) => n.reg)).toEqual(['0001', '9999']);
  });

  it('a quebra de linha final NAO conta como linha em branco', () => {
    const r = parseTxt(Buffer.from('|0001|0|\r\n', 'latin1'), layout);
    expect(r.erros).toEqual([]);
  });
});

describe('parseTxt — registro desconhecido', () => {
  it('avisa e preserva a linha, sem descartar dado do usuario', () => {
    const r = parseTxt(txt('|ZZZZ|dado do usuario|outro|'), layout);
    expect(r.erros).toEqual([]);
    expect(r.avisos.some((a) => a.registro === 'ZZZZ')).toBe(true);
    expect(r.nos).toHaveLength(1);
    expect(r.nos[0]?.valores).toEqual(['ZZZZ', 'dado do usuario', 'outro']);
  });

  it('trata o bloco I, que tem leiaute em ADE separado e nao esta no dicionario', () => {
    const r = parseTxt(txt('|I001|0|', '|I990|2|'), layout);
    expect(r.erros).toEqual([]);
    expect(r.nos).toHaveLength(2);
    // abertura e encerramento de bloco sao nivel 1 pela convencao estrutural
    expect(r.nos.map((n) => n.nivel)).toEqual([1, 1]);
  });
});

describe('parseTxt — quantidade de campos divergente', () => {
  it('avisa mas NAO preenche nem trunca', () => {
    const esperado = layout.registro('0110')?.qtd_campos ?? 0;
    const r = parseTxt(txt('|0110|1|2|3|4|5|6|'), layout);
    const valores = r.nos[0]?.valores ?? [];

    expect(valores.length).not.toBe(esperado);
    expect(r.avisos.some((a) => a.registro === '0110')).toBe(true);
    // truncar destruiria dado valido: ha registro real em que o dicionario e
    // que esta errado (D100 tem 23 campos no arquivo aprovado pelo PVA).
    expect(valores).toEqual(['0110', '1', '2', '3', '4', '5', '6']);
    expect(r.erros).toEqual([]);
  });

  it('campos a menos tambem so geram aviso', () => {
    const r = parseTxt(txt('|0000|006|'), layout);
    expect(r.avisos.some((a) => a.registro === '0000')).toBe(true);
    expect(r.nos[0]?.valores).toEqual(['0000', '006']);
  });
});

describe('parseTxt — hierarquia', () => {
  it('liga o filho ao pai imediatamente acima', () => {
    const r = parseTxt(
      txt('|0000|006|0|||01012021|31012021|X|1|SP|1||00|2|', '|C001|0|', '|C010|1|1|', '|C100|x|'),
      layout,
    );
    const [r0000, c001, c010, c100] = r.nos;
    expect(r0000?.paiId).toBeNull();
    expect(c001?.paiId).toBe(r0000?.id); // nivel 1 -> pai nivel 0
    expect(c010?.paiId).toBe(c001?.id); // nivel 2 -> pai nivel 1
    expect(c100?.paiId).toBe(c010?.id); // nivel 3 -> pai nivel 2
  });

  it('nivel pulado nao quebra a pilha: avisa, deixa orfao e segue', () => {
    // C170 e nivel 4 e aparece logo apos C001 (nivel 1), pulando 2 e 3.
    // O 0000 no inicio da um pai REAL ao C001 e ao C990 — sem ele os dois
    // ficariam com paiId null e a assercao final nao provaria nada.
    const r = parseTxt(
      txt('|0000|006|0|||01012021|31012021|X|1|SP|1||00|2|', '|C001|0|', '|C170|1|', '|C990|3|'),
      layout,
    );
    const [r0000, c001, c170, c990] = r.nos;

    expect(c001?.paiId).toBe(r0000?.id);
    expect(c170?.nivel).toBe(4);
    expect(c170?.paiId).toBeNull(); // nao ha nivel 3 acima
    expect(r.avisos.some((a) => a.registro === 'C170')).toBe(true);

    // a pilha sobrevive ao salto: o C990 seguinte volta a achar o 0000
    expect(c990?.nivel).toBe(1);
    expect(c990?.paiId).toBe(r0000?.id);
    expect(r.erros).toEqual([]);
  });

  it('descarta niveis mais fundos ao voltar para um nivel raso', () => {
    const r = parseTxt(
      txt('|0000|006|0|||01012021|31012021|X|1|SP|1||00|2|', '|C001|0|', '|C010|1|1|', '|C001|0|'),
      layout,
    );
    const ultimo = r.nos[3];
    // o segundo C001 e nivel 1: volta a pendurar no 0000, nao no C010
    expect(ultimo?.paiId).toBe(r.nos[0]?.id);
  });
});

describe('parseTxt — cabecalho do registro 0000', () => {
  it('extrai CNPJ, razao social e periodo dos campos 6 a 9', () => {
    const r = parseTxt(fixture('efd_minimo.txt'), layout);
    expect(r.cabecalho).toEqual({
      dtIni: '01012021',
      dtFin: '31012021',
      razaoSocial: 'AÇÃO COMÉRCIO E EXPORTAÇÃO LTDA',
      cnpj: '12345678000199',
    });
  });

  it('avisa quando nao ha 0000, sem lancar', () => {
    const r = parseTxt(txt('|0001|0|'), layout);
    expect(r.cabecalho).toEqual({ dtIni: '', dtFin: '', razaoSocial: '', cnpj: '' });
    expect(r.avisos.some((a) => /0000/.test(a.mensagem))).toBe(true);
  });
});

describe('parseTxt — nunca lanca excecao', () => {
  const entradas: [string, Buffer][] = [
    ['vazio', Buffer.alloc(0)],
    ['so quebras de linha', Buffer.from('\r\n\r\n\r\n', 'latin1')],
    ['binario', Buffer.from([0x00, 0xff, 0x7c, 0x01, 0x7c, 0xfe])],
    ['pipes soltos', Buffer.from('||||\r\n|\r\n', 'latin1')],
    ['sem quebra final', Buffer.from('|0001|0|', 'latin1')],
    ['BOM de UTF-8', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('|0001|0|\r\n')])],
  ];

  for (const [nome, buffer] of entradas) {
    it(`entrada "${nome}" devolve resultado em vez de lancar`, () => {
      const r = parseTxt(buffer, layout);
      expect(Array.isArray(r.nos)).toBe(true);
      expect(Array.isArray(r.erros)).toBe(true);
      expect(Array.isArray(r.avisos)).toBe(true);
      expect(r.cabecalho).toBeDefined();
    });
  }

  it('remove o BOM e ainda le o registro', () => {
    const r = parseTxt(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('|0001|0|\r\n', 'latin1')]),
      layout,
    );
    expect(r.nos[0]?.reg).toBe('0001');
    expect(r.avisos.some((a) => /BOM/i.test(a.mensagem))).toBe(true);
  });
});

describe('parseTxt — arquivo minimo completo', () => {
  it('le as 13 linhas sem erro', () => {
    const r = parseTxt(fixture('efd_minimo.txt'), layout);
    expect(r.erros).toEqual([]);
    expect(r.nos).toHaveLength(13);
    expect(r.nos.map((n) => n.ordem)).toEqual([...Array(13)].map((_, i) => i + 1));
  });

  it('avisa que o 9990 tem 2 campos contra os 3 do dicionario', () => {
    // Defeito conhecido do dicionario: o arquivo real aprovado pelo PVA tem
    // 2 campos no 9990. Ver docs/DICIONARIO-ACHADOS.md.
    const r = parseTxt(fixture('efd_minimo.txt'), layout);
    expect(r.avisos.filter((a) => a.registro === '9990')).toHaveLength(1);
  });
});

describe('parseTxt — fixture de erros', () => {
  it('acumula cada defeito na severidade certa e nao para na primeira falha', () => {
    const r = parseTxt(fixture('efd_com_erros.txt'), layout);

    // erro: linha sem pipe inicial (3) e linha em branco (4)
    expect(r.erros.map((e) => e.linha).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([3, 4]);
    // as duas linhas defeituosas nao viram no; as outras 11 sim
    expect(r.nos).toHaveLength(11);

    // avisos: registro desconhecido, contagem divergente, orfao por nivel pulado
    expect(r.avisos.some((a) => a.registro === 'XXXX')).toBe(true);
    expect(r.avisos.some((a) => a.registro === '0110')).toBe(true);
    expect(r.avisos.some((a) => a.registro === 'C170')).toBe(true);
  });

  it('numera a ordem sem buraco, mas guarda a linha original do arquivo', () => {
    const r = parseTxt(fixture('efd_com_erros.txt'), layout);
    expect(r.nos.map((n) => n.ordem)).toEqual([...Array(11)].map((_, i) => i + 1));
    // a linha 5 do arquivo e o 5o no? nao: duas linhas foram puladas antes
    const xxxx = r.nos.find((n) => n.reg === 'XXXX');
    expect(xxxx?.linhaOriginal).toBe(5);
    expect(xxxx?.ordem).toBe(3);
  });
});

describe('parseTxt — arquivo real reduzido', () => {
  it('le as 153 linhas sem nenhum erro', () => {
    const r = parseTxt(fixture('efd_reduzido.txt'), layout);
    expect(r.erros).toEqual([]);
    expect(r.nos).toHaveLength(153);
  });

  it('extrai o cabecalho e resolve a hierarquia', () => {
    const r = parseTxt(fixture('efd_reduzido.txt'), layout);
    expect(r.cabecalho.cnpj).toMatch(/^\d{14}$/);
    expect(r.cabecalho.dtIni).toBe('01122021');
    expect(r.cabecalho.dtFin).toBe('31122021');

    // todo no de nivel > 0 achou pai, exceto os que o proprio parser avisou
    const orfaos = r.nos.filter((n) => n.nivel > 0 && n.paiId === null);
    expect(orfaos).toEqual([]);
  });

  it('guarda o bastante para reconstruir cada linha do arquivo', () => {
    // Invariante que sustenta o round-trip byte a byte de F1-T5: para todo
    // no, '|' + valores.join('|') + '|' tem de devolver a linha original.
    const bytes = fixture('efd_reduzido.txt');
    const original = bytes.toString('latin1').split('\r\n').filter((l) => l !== '');
    const r = parseTxt(bytes, layout);

    const reconstruido = r.nos.map((n) => `|${n.valores.join('|')}|`);
    expect(reconstruido).toEqual(original);
    expect(Buffer.from(reconstruido.join('\r\n') + '\r\n', 'latin1').equals(bytes)).toBe(true);
  });

  it('avisa nos 8 registros em que o dicionario diverge do arquivo real', () => {
    const r = parseTxt(fixture('efd_reduzido.txt'), layout);
    const comAviso = new Set(
      r.avisos.filter((a) => /campos; leiaute preve/.test(a.mensagem)).map((a) => a.registro),
    );
    expect(comAviso).toEqual(
      new Set(['0111', '0500', '1100', '9990', 'C500', 'D100', 'M110', 'M500']),
    );
  });
});
