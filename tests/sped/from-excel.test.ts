// F2-T2: um teste por linha da tabela de casos de borda da spec 5.4.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { lerExcel } from '@/lib/sped/from-excel';
import { carregarLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import { gerarExcel } from '@/lib/sped/to-excel';
import type { Layout, ResultadoParse } from '@/lib/sped/types';

let layout: Layout;
beforeAll(() => {
  layout = carregarLayout();
});

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));
const txt = (...linhas: string[]) => Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1');

/** Arquivo pequeno com hierarquia de verdade: 0000 > C001 > C010 > C100 > C170. */
const COM_HIERARQUIA = [
  '|0000|006|0|||01012021|31012021|EMPRESA TESTE|11222333000181|SP|3550308|||1|',
  '|0001|0|',
  '|0990|3|',
  '|C001|0|',
  '|C010|11222333000181|1|',
  '|C100|0|1|FORNEC|55|00|1|000001|',
  '|C170|1|ITEM01|DESCRICAO|10|UN|00123|',
  '|C990|5|',
];

/** Gera o XLSX de um TXT, como a Fase 2 faz. */
async function paraExcel(linhas: string[]): Promise<{ xlsx: Buffer; ast: ResultadoParse }> {
  const ast = parseTxt(txt(...linhas), layout);
  return { xlsx: await gerarExcel(ast, layout), ast };
}

/** Abre, deixa o teste mexer na planilha, e devolve o buffer alterado. */
async function mexer(
  xlsx: Buffer,
  mudanca: (wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  mudanca(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('5.4 — aba _META e o contrato de reconversao', () => {
  it('sem _META, recusa o arquivo', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      wb.removeWorksheet(wb.getWorksheet('_META')!.id);
    });
    const r = await lerExcel(alterado, layout);
    expect(r.erros.some((e) => /_META/.test(e.mensagem))).toBe(true);
    expect(r.nos).toEqual([]);
  });

  it('versao do guia divergente e erro bloqueante', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('_META')!;
      ws.eachRow((linha) => {
        if (String(linha.getCell(1).value) === 'versao_guia') linha.getCell(2).value = '1.20';
      });
    });
    const r = await lerExcel(alterado, layout);
    expect(r.erros.some((e) => e.campo === 'versao_guia')).toBe(true);
    expect(r.nos).toEqual([]);
  });

  it('arquivo que nao e XLSX nao lanca, devolve erro', async () => {
    const r = await lerExcel(Buffer.from('isto nao e um xlsx'), layout);
    expect(r.erros.length).toBeGreaterThan(0);
    expect(r.nos).toEqual([]);
  });
});

describe('5.4 — usuario apaga linha pai que tinha filhos', () => {
  it('erro bloqueante de registro filho orfao', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      // apaga o C100, deixando o C170 sem pai
      const ws = wb.getWorksheet('C100')!;
      ws.spliceRows(2, 1);
    });
    const r = await lerExcel(alterado, layout);

    const orfao = r.erros.find((e) => /órfão/.test(e.mensagem));
    expect(orfao).toBeDefined();
    expect(orfao?.registro).toBe('C170');
    expect(orfao?.mensagem).toMatch(/pai/);
  });
});

describe('5.4 — usuario adiciona linha sem _id e sem _pai', () => {
  it('gera id novo e infere o pai pela ordem', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('C170')!;
      const cabecalho = ws.getRow(1);
      const coluna = (nome: string) => {
        let achou = 0;
        cabecalho.eachCell((c, n) => {
          if (String(c.value) === nome) achou = n;
        });
        return achou;
      };
      const nova = ws.addRow([]);
      // sem _id, sem _pai, sem _ordem: linha digitada na mao
      nova.getCell(coluna('REG')).value = 'C170';
      nova.getCell(coluna('NUM_ITEM')).value = '2';
      nova.getCell(coluna('COD_ITEM')).value = 'ITEM02';
      nova.commit();
    });

    const r = await lerExcel(alterado, layout);
    const doC170 = r.nos.filter((n) => n.reg === 'C170');
    expect(doC170).toHaveLength(2);

    const nova = doC170.find((n) => n.valores[1] === '2');
    expect(nova).toBeDefined();
    expect(nova?.id).toBeTruthy(); // id gerado
    expect(nova?.paiId).toBeTruthy(); // pai inferido
    expect(r.avisos.some((a) => /sem _ordem/.test(a.mensagem))).toBe(true);
    expect(r.erros.filter((e) => /órfão/.test(e.mensagem))).toEqual([]);
  });

  it('a linha nova entra depois da ultima do mesmo registro, nao no fim do arquivo', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('C170')!;
      const nova = ws.addRow([]);
      nova.getCell(4).value = 'C170'; // REG e a 4a coluna
      nova.getCell(5).value = '2';
      nova.commit();
    });

    const r = await lerExcel(alterado, layout);
    const regs = r.nos.map((n) => n.reg);
    // ...C100, C170, C170, C990 — e nao C990 antes dos C170
    expect(regs.indexOf('C990')).toBeGreaterThan(regs.lastIndexOf('C170'));
  });
});

describe('5.4 — usuario reordena colunas', () => {
  it('funciona, porque o mapeamento e por nome', async () => {
    const { xlsx, ast } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('0000')!;
      // troca as colunas de CNPJ e NOME de lugar, cabecalho e dados juntos
      const iNome = 4 + 7; // _id,_pai,_ordem + campo 8
      const iCnpj = 4 + 8;
      ws.eachRow((linha) => {
        const a = linha.getCell(iNome).value;
        const b = linha.getCell(iCnpj).value;
        linha.getCell(iNome).value = b;
        linha.getCell(iCnpj).value = a;
        linha.commit();
      });
    });

    const r = await lerExcel(alterado, layout);
    const no0000 = r.nos.find((n) => n.reg === '0000');
    const original = ast.nos.find((n) => n.reg === '0000');
    // NOME segue no campo 8 e CNPJ no 9, apesar das colunas trocadas
    expect(no0000?.valores[7]).toBe(original?.valores[7]);
    expect(no0000?.valores[8]).toBe(original?.valores[8]);

    // A fixture e sintetica e ja tem obrigatorios vazios no C100/C170, entao
    // comparar com zero erros nao diria nada. O que importa e que reordenar
    // NAO introduziu erro novo.
    const semReordenar = await lerExcel(xlsx, layout);
    expect(r.erros).toHaveLength(semReordenar.erros.length);
  });

  it('reordenar nao altera nenhum valor de nenhum campo', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const antes = await lerExcel(xlsx, layout);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('0000')!;
      ws.eachRow((linha) => {
        const a = linha.getCell(11).value;
        linha.getCell(11).value = linha.getCell(12).value;
        linha.getCell(12).value = a;
        linha.commit();
      });
    });
    const depois = await lerExcel(alterado, layout);

    expect(depois.nos.map((n) => n.valores)).toEqual(antes.nos.map((n) => n.valores));
  });
});

describe('5.4 — usuario renomeia uma aba', () => {
  it('avisa e ignora a aba', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      wb.getWorksheet('C170')!.name = 'C170 conferido';
    });
    const r = await lerExcel(alterado, layout);

    expect(r.avisos.some((a) => a.aba === 'C170 conferido' && /ignorada/.test(a.mensagem))).toBe(
      true,
    );
    expect(r.nos.some((n) => n.reg === 'C170')).toBe(false);
  });
});

describe('5.4 — celula obrigatoria vazia', () => {
  it('erro bloqueante com aba, linha e campo', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('0000')!;
      ws.getRow(2).getCell(4 + 7).value = null; // NOME, obrigatorio
      ws.getRow(2).commit();
    });

    const r = await lerExcel(alterado, layout);
    const erro = r.erros.find((e) => e.campo === 'NOME');
    expect(erro).toBeDefined();
    expect(erro).toMatchObject({ severidade: 'erro', aba: '0000', registro: '0000' });
    expect(erro?.linha).toBeGreaterThan(0);
  });
});

describe('5.4 — Excel converteu "00123" em numero', () => {
  it('avisa de possivel perda de zero a esquerda em campo de tamanho fixo', async () => {
    // CNPJ e N 014*: se o Excel guardar como numero, 011222333000181 perde o
    // zero e sobra com 14 caracteres — aqui usamos um valor mais curto para
    // forcar a deteccao.
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('0000')!;
      const celula = ws.getRow(2).getCell(4 + 8); // CNPJ
      celula.value = 11222333000181; // numero, nao texto
      celula.numFmt = 'General';
      ws.getRow(2).commit();
    });

    const r = await lerExcel(alterado, layout);
    // 11222333000181 tem 14 digitos, entao nao perde nada: sem aviso.
    expect(r.avisos.filter((a) => /zero à esquerda/.test(a.mensagem))).toEqual([]);

    const menor = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('0000')!;
      const celula = ws.getRow(2).getCell(4 + 8);
      celula.value = 123; // seria "00000000000123"
      celula.numFmt = 'General';
      ws.getRow(2).commit();
    });
    const r2 = await lerExcel(menor, layout);
    const aviso = r2.avisos.find((a) => /zero à esquerda/.test(a.mensagem));
    expect(aviso).toBeDefined();
    expect(aviso?.campo).toBe('CNPJ');
  });

  it('numero em campo com decimais volta com virgula, nao com ponto', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alvo = layout.registro('C170')!.campos.find((c) => c.decimais === 2)!;
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('C170')!;
      let coluna = 0;
      ws.getRow(1).eachCell((c, n) => {
        if (String(c.value) === alvo.nome) coluna = n;
      });
      const celula = ws.getRow(2).getCell(coluna);
      celula.value = 1234.5;
      celula.numFmt = 'General';
      ws.getRow(2).commit();
    });

    const r = await lerExcel(alterado, layout);
    const c170 = r.nos.find((n) => n.reg === 'C170');
    expect(c170?.valores[alvo.num - 1]).toBe('1234,50');
  });

  it('data volta como ddmmaaaa', async () => {
    const { xlsx } = await paraExcel(COM_HIERARQUIA);
    const alterado = await mexer(xlsx, (wb) => {
      const ws = wb.getWorksheet('0000')!;
      const celula = ws.getRow(2).getCell(4 + 5); // DT_INI
      celula.value = new Date(Date.UTC(2021, 0, 1));
      ws.getRow(2).commit();
    });
    const r = await lerExcel(alterado, layout);
    expect(r.nos.find((n) => n.reg === '0000')?.valores[5]).toBe('01012021');
  });
});

describe('lerExcel — registro fora do dicionario', () => {
  it('le as colunas posicionais em vez de descartar a linha', async () => {
    const ast = parseTxt(fixture('efd_reduzido.txt'), layout);
    const r = await lerExcel(await gerarExcel(ast, layout), layout);

    expect(r.nos.filter((n) => n.reg === 'I001')).toHaveLength(1);
    expect(r.nos.filter((n) => n.reg === 'I990')).toHaveLength(1);
    expect(r.avisos.some((a) => a.aba === 'I001')).toBe(true);
  });
});
