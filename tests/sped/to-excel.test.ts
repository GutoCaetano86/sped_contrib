import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
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

/** Abre o XLSX gerado, como o usuario faria. */
async function abrir(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

const doArquivo = (nome: string): ResultadoParse => parseTxt(fixture(nome), layout);

describe('gerarExcel — criterio de aceite: nada de coercao do Excel', () => {
  it('"00123" continua "00123" e "0,65" continua "0,65"', async () => {
    // O criterio explicito de F2-T1. Sem numFmt '@' o Excel transforma o
    // primeiro em 123 e o segundo em numero com ponto.
    const res = parseTxt(txt('|C170|00123|ITEM|DESC|0,65|000|1,50|'), layout);
    const wb = await abrir(await gerarExcel(res, layout));
    const ws = wb.getWorksheet('C170');
    expect(ws).toBeDefined();

    const linha = ws!.getRow(2); // 1 e o cabecalho
    // colunas: 1=_id 2=_pai 3=_ordem, dados a partir da 4
    expect(linha.getCell(5).value).toBe('00123');
    expect(linha.getCell(8).value).toBe('0,65');
    expect(linha.getCell(9).value).toBe('000');
    expect(linha.getCell(10).value).toBe('1,50');

    // e o formato que impede o Excel de mexer nisso ao abrir
    expect(linha.getCell(5).numFmt).toBe('@');
    expect(linha.getCell(8).numFmt).toBe('@');
  });

  it('toda celula de dado sai como texto, nao como numero', async () => {
    const res = parseTxt(txt('|C170|1|ITEM|DESC|10|UN|100,00|'), layout);
    const wb = await abrir(await gerarExcel(res, layout));
    const linha = wb.getWorksheet('C170')!.getRow(2);

    for (let c = 4; c <= 8; c++) {
      const celula = linha.getCell(c);
      expect(typeof celula.value === 'string' || celula.value === null).toBe(true);
      expect(celula.numFmt).toBe('@');
    }
  });

  it('nenhum valor do arquivo real se perde ou se altera', async () => {
    // Verificacao ampla: cada valor de cada no tem de reaparecer identico na
    // celula correspondente.
    const res = doArquivo('efd_reduzido.txt');
    const wb = await abrir(await gerarExcel(res, layout));

    let conferidos = 0;
    for (const no of res.nos) {
      const ws = wb.getWorksheet(no.reg);
      expect(ws, `aba ${no.reg} deveria existir`).toBeDefined();
      const linha = [...Array(ws!.rowCount)]
        .map((_, i) => ws!.getRow(i + 1))
        .find((l) => l.getCell(1).value === no.id);
      expect(linha, `linha do no ${no.id} (${no.reg})`).toBeDefined();

      no.valores.forEach((valor, i) => {
        const celula = linha!.getCell(4 + i);
        const lido = celula.value === null ? '' : String(celula.value);
        expect(lido, `${no.reg} campo ${i + 1}`).toBe(valor);
        conferidos++;
      });
    }
    expect(conferidos).toBeGreaterThan(500);
  });
});

describe('gerarExcel — aba _META', () => {
  it('e a primeira aba e traz o contrato de reconversao', async () => {
    const res = doArquivo('efd_reduzido.txt');
    const wb = await abrir(
      await gerarExcel(res, layout, { arquivoOrigem: 'efd.txt', hashOrigem: 'abc123' }),
    );

    expect(wb.worksheets[0]?.name).toBe('_META');
    const ws = wb.getWorksheet('_META')!;
    const meta = new Map<string, string>();
    ws.eachRow((linha) => meta.set(String(linha.getCell(1).value), String(linha.getCell(2).value)));

    expect(meta.get('layout')).toBe('EFD-Contribuicoes');
    expect(meta.get('versao_guia')).toBe('1.35');
    expect(meta.get('arquivo_origem')).toBe('efd.txt');
    expect(meta.get('hash_origem')).toBe('abc123');
    expect(meta.get('cnpj')).toBe(res.cabecalho.cnpj);
    expect(meta.get('razao_social')).toBe(res.cabecalho.razaoSocial);
    expect(meta.get('total_linhas')).toBe(String(res.nos.length));
    expect(meta.get('periodo')).toContain(res.cabecalho.dtIni);
    expect(meta.get('gerado_em')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('gerarExcel — estrutura das abas', () => {
  it('cria uma aba por tipo de registro, na ordem oficial dos blocos', async () => {
    const res = doArquivo('efd_reduzido.txt');
    const wb = await abrir(await gerarExcel(res, layout));

    const abas = wb.worksheets.map((w) => w.name).filter((n) => !n.startsWith('_'));
    const tipos = new Set(res.nos.map((n) => n.reg));
    expect(new Set(abas)).toEqual(tipos);

    const posicao = (bloco: string) => layout.ordem_blocos.indexOf(bloco);
    const blocos = abas.map((a) => posicao(a[0] ?? ''));
    expect(blocos).toEqual([...blocos].sort((a, b) => a - b));
  });

  it('as tres colunas de controle vem primeiro, com _id e _pai ocultas', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_minimo.txt'), layout));
    const ws = wb.getWorksheet('0000')!;

    expect(ws.getRow(1).getCell(1).value).toBe('_id');
    expect(ws.getRow(1).getCell(2).value).toBe('_pai');
    expect(ws.getRow(1).getCell(3).value).toBe('_ordem');
    expect(ws.getRow(1).getCell(4).value).toBe('REG');

    expect(ws.getColumn(1).hidden).toBe(true);
    expect(ws.getColumn(2).hidden).toBe(true);
    expect(ws.getColumn(3).hidden).toBeFalsy();
  });

  it('_ordem sai numerico, para o usuario poder ordenar por ela', async () => {
    // Como texto, "10" viria antes de "2" ao classificar na planilha.
    const wb = await abrir(await gerarExcel(doArquivo('efd_reduzido.txt'), layout));
    const ws = wb.getWorksheet('9900')!;
    expect(typeof ws.getRow(2).getCell(3).value).toBe('number');
  });

  it('_id e _pai ligam pai e filho', async () => {
    const res = parseTxt(
      txt('|0000|006|0|||01012021|31012021|X|1|SP|1||00|2|', '|C001|0|', '|C010|1|1|'),
      layout,
    );
    const wb = await abrir(await gerarExcel(res, layout));
    const idC001 = wb.getWorksheet('C001')!.getRow(2).getCell(1).value;
    expect(wb.getWorksheet('C010')!.getRow(2).getCell(2).value).toBe(idC001);
  });
});

describe('gerarExcel — formatacao do cabecalho', () => {
  it('linha 1 em negrito, fundo 1F4E79 e texto branco', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_minimo.txt'), layout));
    const celula = wb.getWorksheet('0000')!.getRow(1).getCell(4);

    expect(celula.font?.bold).toBe(true);
    expect(celula.font?.color?.argb).toBe('FFFFFFFF');
    expect((celula.fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe('FF1F4E79');
  });

  it('painel congelado em D2 e autofiltro na linha 1', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_minimo.txt'), layout));
    const ws = wb.getWorksheet('0000')!;

    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 1 });
    expect(ws.autoFilter).toBeDefined();
  });

  it('cada cabecalho tem comentario com tipo, tamanho e obrigatoriedade', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_minimo.txt'), layout));
    const ws = wb.getWorksheet('0000')!;

    // campo 9 do 0000 e o CNPJ: N 014*, obrigatorio
    const nota = ws.getRow(1).getCell(3 + 9).note;
    const texto = typeof nota === 'string' ? nota : (nota?.texts ?? []).map((t) => t.text).join('');
    expect(texto).toContain('N 014*');
    expect(texto).toContain('obrigatório');
  });

  it('largura da coluna segue min(max(nome+2, 12), 40)', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_minimo.txt'), layout));
    const ws = wb.getWorksheet('0000')!;

    // REG tem 3 letras -> piso de 12
    expect(ws.getColumn(4).width).toBe(12);
    // NUM_REC_ANTERIOR tem 16 -> 18
    const coluna = layout.registro('0000')!.campos.findIndex((c) => c.nome === 'NUM_REC_ANTERIOR');
    expect(ws.getColumn(4 + coluna).width).toBe(18);
  });
});

describe('gerarExcel — linha de descricao', () => {
  it('nao aparece por padrao', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_minimo.txt'), layout));
    // linha 2 ja e dado: a primeira celula e o _id
    expect(String(wb.getWorksheet('0000')!.getRow(2).getCell(1).value)).toMatch(/^r\d+/);
  });

  it('com incluirDescricoes, entra na linha 2 em italico', async () => {
    const wb = await abrir(
      await gerarExcel(doArquivo('efd_minimo.txt'), layout, { incluirDescricoes: true }),
    );
    const ws = wb.getWorksheet('0000')!;
    const descricao = ws.getRow(2);

    expect(descricao.getCell(1).value).toBeFalsy(); // colunas de controle vazias
    expect(String(descricao.getCell(4).value)).toContain('0000');
    expect(descricao.font?.italic).toBe(true);
    expect(String(ws.getRow(3).getCell(1).value)).toMatch(/^r\d+/); // dado desce
  });

  it('trunca a descricao em 120 caracteres', async () => {
    const wb = await abrir(
      await gerarExcel(doArquivo('efd_reduzido.txt'), layout, { incluirDescricoes: true }),
    );
    const ws = wb.getWorksheet('1100')!;
    ws.getRow(2).eachCell((celula) => {
      expect(String(celula.value ?? '').length).toBeLessThanOrEqual(120);
    });
  });
});

describe('gerarExcel — aba _ERROS', () => {
  it('nao existe quando o arquivo esta limpo', async () => {
    const res = parseTxt(txt('|0001|0|'), layout);
    res.avisos.length = 0;
    const wb = await abrir(await gerarExcel(res, layout));
    expect(wb.getWorksheet('_ERROS')).toBeUndefined();
  });

  it('lista severidade, linha, registro, campo e mensagem', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_com_erros.txt'), layout));
    const ws = wb.getWorksheet('_ERROS');
    expect(ws).toBeDefined();

    expect(ws!.getRow(1).values).toEqual(
      expect.arrayContaining(['severidade', 'linha', 'registro', 'campo', 'mensagem']),
    );
    const severidades = new Set<string>();
    ws!.eachRow((linha, n) => {
      if (n > 1) severidades.add(String(linha.getCell(1).value));
    });
    expect(severidades.has('erro')).toBe(true);
  });
});

describe('gerarExcel — registro fora do dicionario', () => {
  it('gera aba com colunas posicionais em vez de descartar a linha', async () => {
    // I001 e I990 aparecem em arquivo real; o bloco I tem leiaute em ADE
    // separado e nao consta do dicionario.
    const wb = await abrir(await gerarExcel(doArquivo('efd_reduzido.txt'), layout));
    const ws = wb.getWorksheet('I001');
    expect(ws).toBeDefined();

    expect(ws!.getRow(1).getCell(4).value).toBe('REG');
    expect(String(ws!.getRow(1).getCell(5).value)).toMatch(/^CAMPO_\d{2}$/);
    expect(ws!.getRow(2).getCell(4).value).toBe('I001');
  });
});
