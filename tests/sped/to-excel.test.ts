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

/**
 * Coluna do campo 1 (REG) na aba.
 *
 * Nao e uma posicao fixa: antes dos campos do leiaute vem as colunas de
 * controle e, na aba de registro filho, as colunas derivadas do pai. Procurar
 * pelo cabecalho e o mesmo que o from-excel.ts faz.
 */
/** Comentario da celula; o exceljs devolve string ou texto rico. */
function textoDaNota(celula: ExcelJS.Cell): string {
  const nota = celula.note;
  if (typeof nota === 'string') return nota;
  return (nota?.texts ?? []).map((t) => t.text).join('');
}

function colunaDoReg(ws: ExcelJS.Worksheet): number {
  let achada = 0;
  ws.getRow(1).eachCell({ includeEmpty: false }, (celula, coluna) => {
    if (achada === 0 && String(celula.value) === 'REG') achada = coluna;
  });
  expect(achada, `aba ${ws.name} sem coluna REG`).toBeGreaterThan(0);
  return achada;
}

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

      const primeira = colunaDoReg(ws!);
      no.valores.forEach((valor, i) => {
        const celula = linha!.getCell(primeira + i);
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
    const texto = textoDaNota(ws.getRow(1).getCell(3 + 9));
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

describe('gerarExcel — colunas de contexto do registro pai', () => {
  /** Cabecalhos da linha 1, na ordem em que aparecem. */
  const cabecalhos = (ws: ExcelJS.Worksheet): string[] => {
    const nomes: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (celula) => nomes.push(String(celula.value)));
    return nomes;
  };

  it('a aba C170 traz item, CNPJ do C010 e identificacao do C100 antes de REG', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_reduzido.txt'), layout));
    const nomes = cabecalhos(wb.getWorksheet('C170')!);

    // Sem isto o usuario abre a aba dos itens e nao sabe de qual nota cada
    // item e: o vinculo existe so no _pai, que e id opaco e oculto.
    expect(nomes.slice(0, 3)).toEqual(['_id', '_pai', '_ordem']);
    expect(nomes).toContain('_item_pai');
    expect(nomes).toContain('_C010_CNPJ');
    expect(nomes).toContain('_C100_NUM_DOC');
    expect(nomes).toContain('_C100_COD_PART');
    // e todas antes do primeiro campo do proprio registro
    expect(nomes.indexOf('_C100_NUM_DOC')).toBeLessThan(nomes.indexOf('REG'));
  });

  it('o valor da coluna derivada e o do registro pai daquela linha', async () => {
    const res = doArquivo('efd_reduzido.txt');
    const wb = await abrir(await gerarExcel(res, layout));
    const ws = wb.getWorksheet('C170')!;
    const nomes = cabecalhos(ws);
    const col = (nome: string) => nomes.indexOf(nome) + 1;

    const porId = new Map(res.nos.map((n) => [n.id, n]));
    let conferidos = 0;

    ws.eachRow((linha, n) => {
      if (n === 1) return;
      const no = porId.get(String(linha.getCell(1).value));
      expect(no).toBeDefined();
      const c100 = porId.get(no!.paiId ?? '');
      expect(c100?.reg).toBe('C100');
      const c010 = porId.get(c100!.paiId ?? '');
      expect(c010?.reg).toBe('C010');

      // C100: 04 COD_PART, 07 SER, 08 NUM_DOC. C010: 02 CNPJ.
      expect(String(linha.getCell(col('_C100_NUM_DOC')).value)).toBe(c100!.valores[7]);
      expect(String(linha.getCell(col('_C100_COD_PART')).value)).toBe(c100!.valores[3]);
      expect(String(linha.getCell(col('_C010_CNPJ')).value)).toBe(c010!.valores[1]);
      conferidos++;
    });

    expect(conferidos).toBeGreaterThan(0);
  });

  it('_item_pai numera a instancia do pai, para agrupar os itens de uma nota', async () => {
    const res = parseTxt(
      txt(
        '|0000|006|0|||01122021|31122021|EMPRESA|11111111000191|RS|4314902|||1|',
        '|C001|0|',
        '|C010|11111111000191|2|',
        '|C100|0|1|F001|55|00|1|100|CHV|01122021|01122021|1000,00|',
        '|C170|1|IT1|PRIMEIRO ITEM|',
        '|C170|2|IT2|SEGUNDO ITEM|',
        '|C100|0|1|F001|55|00|1|200|CHV|02122021|02122021|2000,00|',
        '|C170|1|IT3|TERCEIRO ITEM|',
      ),
      layout,
    );
    const ws = (await abrir(await gerarExcel(res, layout))).getWorksheet('C170')!;
    const nomes = cabecalhos(ws);
    const colItem = nomes.indexOf('_item_pai') + 1;
    const colNum = nomes.indexOf('_C100_NUM_DOC') + 1;

    const itens: string[] = [];
    const numeros: string[] = [];
    ws.eachRow((linha, n) => {
      if (n === 1) return;
      itens.push(String(linha.getCell(colItem).value));
      numeros.push(String(linha.getCell(colNum).value));
    });

    expect(itens).toEqual(['1', '1', '2']);
    expect(numeros).toEqual(['100', '100', '200']);
  });

  it('coluna derivada nunca colide com campo do leiaute e se anuncia como derivada', async () => {
    // O prefixo `_` e o que garante as duas coisas: nenhum campo do leiaute
    // comeca com sublinhado, entao o from-excel.ts ignora estas colunas ao
    // remontar o TXT e o mapeamento por nome nao erra o campo.
    const wb = await abrir(await gerarExcel(doArquivo('efd_reduzido.txt'), layout));
    const nomesDeCampo = new Set(
      [...layout.registros.values()].flatMap((r) => r.campos.map((c) => c.nome)),
    );

    for (const ws of wb.worksheets) {
      for (const nome of cabecalhos(ws)) {
        if (!nome.startsWith('_')) continue;
        expect(nomesDeCampo.has(nome), `${ws.name}: ${nome} colide com campo do leiaute`).toBe(
          false,
        );
      }
    }

    // O usuario tem de descobrir na planilha que editar ali nao muda o TXT:
    // cor propria no cabecalho e comentario dizendo de onde o valor vem.
    const ws = wb.getWorksheet('C170')!;
    const cabecalho = ws.getRow(1);
    const coluna = cabecalhos(ws).indexOf('_C100_NUM_DOC') + 1;
    const fill = cabecalho.getCell(coluna).fill;
    expect(fill?.type === 'pattern' && fill.fgColor?.argb).toBe('FF375623');
    expect(textoDaNota(cabecalho.getCell(coluna))).toMatch(/derivada/i);
    expect(textoDaNota(cabecalho.getCell(coluna))).toMatch(/C100/);
  });

  it('aba sem contexto util nao ganha coluna derivada', async () => {
    const wb = await abrir(await gerarExcel(doArquivo('efd_reduzido.txt'), layout));

    // 0000 nao tem pai; C001 tem, mas o pai (0000) nao identifica documento.
    for (const aba of ['0000', 'C001']) {
      const nomes = cabecalhos(wb.getWorksheet(aba)!);
      expect(nomes.filter((n) => n.startsWith('_'))).toEqual(['_id', '_pai', '_ordem']);
    }
  });
});

describe('gerarExcel — registro fora do dicionario', () => {
  it('gera aba com colunas posicionais em vez de descartar a linha', async () => {
    // I001 e I990 aparecem em arquivo real; o bloco I tem leiaute em ADE
    // separado e nao consta do dicionario.
    const wb = await abrir(await gerarExcel(doArquivo('efd_reduzido.txt'), layout));
    const ws = wb.getWorksheet('I001');
    expect(ws).toBeDefined();

    const primeira = colunaDoReg(ws!);
    expect(String(ws!.getRow(1).getCell(primeira + 1).value)).toMatch(/^CAMPO_\d{2}$/);
    expect(ws!.getRow(2).getCell(primeira).value).toBe('I001');
  });
});
