// XLSX -> AST. Ver docs/SPEC.md secao 5.4.
//
// Regra central: o mapeamento de coluna e POR NOME, nunca por posicao. O
// usuario pode reordenar colunas na planilha, e reordenar nao pode
// reembaralhar os campos do TXT.
import ExcelJS from 'exceljs';
import { nivelDe } from './parser';
import type { CampoLayout, ErroValidacao, Layout, NoRegistro, ResultadoParse } from './types';

/** Colunas de controle escritas por to-excel.ts. */
const COL_ID = '_id';
const COL_PAI = '_pai';
const COL_ORDEM = '_ordem';

/** Nome de aba que parece codigo de registro. */
const RE_CODIGO_REGISTRO = /^[0-9A-Z]{4}$/;
/** Cabecalho posicional que to-excel usa em registro fora do dicionario. */
const RE_CAMPO_GENERICO = /^CAMPO_(\d{2})$/;

const CABECALHO_VAZIO = { cnpj: '', razaoSocial: '', dtIni: '', dtFin: '' };

/** Texto de uma celula, sem inventar formatacao. */
function textoDaCelula(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') {
    // texto rico, formula com resultado, hyperlink
    if ('richText' in valor && Array.isArray(valor.richText)) {
      return valor.richText.map((p) => p.text).join('');
    }
    if ('result' in valor) return textoDaCelula(valor.result as ExcelJS.CellValue);
    if ('text' in valor && typeof valor.text === 'string') return valor.text;
  }
  return String(valor);
}

/** Data para ddmmaaaa, como o leiaute exige (regra inviolavel 6). */
const paraDdMmAaaa = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}`;

/** Numero para o formato do leiaute: virgula decimal, sem separador de milhar. */
function numeroParaLeiaute(n: number, decimais: number): string {
  if (decimais > 0) return n.toFixed(decimais).replace('.', ',');
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}

/** Campo de data, pela convencao do leiaute: prefixo DT_ e 8 posicoes. */
const ehCampoData = (campo: CampoLayout | undefined): boolean =>
  campo !== undefined && campo.nome.startsWith('DT_') && campo.tamanho === 8;

/**
 * Serial de data do Excel para Date.
 *
 * O Excel conta dias desde 1900-01-01 e ainda carrega o bug historico de
 * tratar 1900 como bissexto, por isso a epoca efetiva e 1899-12-30. Digitar
 * uma data numa celula faz o Excel guardar esse numero: sem converter, o
 * campo DT_INI sairia no TXT como "44197".
 */
function serialParaData(serial: number): Date | null {
  // 1 = 1900-01-01; 2958465 = 9999-12-31. Fora disso nao e data.
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Converte a celula no valor de campo do TXT.
 *
 * O to-excel grava tudo como texto, entao o caminho normal e devolver a
 * string intacta. Numero e data aparecem quando o usuario digitou ou colou
 * por cima e o Excel converteu — e ai o formato tem de ser reconstruido.
 */
function valorDoCampo(
  celula: ExcelJS.Cell | undefined,
  campo: CampoLayout | undefined,
  aviso: (mensagem: string, campoNome?: string) => void,
): string {
  const bruto = celula?.value;
  if (bruto === null || bruto === undefined) return '';

  if (bruto instanceof Date) {
    return paraDdMmAaaa(bruto);
  }

  if (typeof bruto === 'number') {
    // Data digitada na planilha volta como serial do Excel, nao como Date.
    if (ehCampoData(campo)) {
      const comoData = serialParaData(bruto);
      if (comoData) {
        aviso(
          `Data veio como número de série do Excel (${bruto}); convertida para ` +
            `${paraDdMmAaaa(comoData)}.`,
          campo?.nome,
        );
        return paraDdMmAaaa(comoData);
      }
    }
    const texto = numeroParaLeiaute(bruto, campo?.decimais ?? 0);
    // Zero a esquerda e significativo (regra inviolavel 7). Se o campo tem
    // tamanho fixo e o numero saiu mais curto, o Excel comeu o zero.
    if (campo?.tamanho_fixo && campo.tamanho > 0 && texto.length < campo.tamanho) {
      aviso(
        `Valor "${texto}" veio como número e ficou com ${texto.length} de ${campo.tamanho} ` +
          `caracteres; possível perda de zero à esquerda.`,
        campo.nome,
      );
    }
    return texto;
  }

  return textoDaCelula(bruto);
}

interface LinhaLida {
  id: string;
  paiDeclarado: string | null;
  ordem: number | null;
  reg: string;
  valores: string[];
  aba: string;
  linhaPlanilha: number;
}

/**
 * Le o XLSX e reconstroi a arvore de registros.
 *
 * Erro aqui BLOQUEIA a geracao do TXT (spec 11, decisao 7): produzir arquivo
 * que o PVA recusa e pior que nao produzir.
 */
export async function lerExcel(buf: Buffer, layout: Layout): Promise<ResultadoParse> {
  const erros: ErroValidacao[] = [];
  const avisos: ErroValidacao[] = [];

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch (causa) {
    erros.push({
      severidade: 'erro',
      mensagem: `Não foi possível abrir o arquivo como XLSX: ${String(causa)}`,
    });
    return { nos: [], cabecalho: { ...CABECALHO_VAZIO }, erros, avisos };
  }

  // ------------------------------------------------------------------ _META
  // Contrato de reconversao: sem ela, ou com layout divergente, recusamos o
  // arquivo (spec 3.4). E o que impede reconverter a planilha de outro
  // leiaute e gerar um TXT sem sentido.
  const meta = new Map<string, string>();
  const abaMeta = wb.getWorksheet('_META');
  if (!abaMeta) {
    erros.push({
      severidade: 'erro',
      aba: '_META',
      mensagem: 'Aba _META ausente: não é um Excel gerado por esta ferramenta.',
    });
    return { nos: [], cabecalho: { ...CABECALHO_VAZIO }, erros, avisos };
  }
  abaMeta.eachRow((linha) => {
    const chave = textoDaCelula(linha.getCell(1).value).trim();
    if (chave) meta.set(chave, textoDaCelula(linha.getCell(2).value).trim());
  });

  if (meta.get('layout') !== layout.layout) {
    erros.push({
      severidade: 'erro',
      aba: '_META',
      campo: 'layout',
      mensagem: `Layout "${meta.get('layout') ?? ''}" diverge de "${layout.layout}".`,
    });
  }
  if (meta.get('versao_guia') !== layout.versao_guia) {
    erros.push({
      severidade: 'erro',
      aba: '_META',
      campo: 'versao_guia',
      mensagem:
        `Versão do guia "${meta.get('versao_guia') ?? ''}" diverge de ` +
        `"${layout.versao_guia}".`,
    });
  }
  if (erros.length > 0) {
    return { nos: [], cabecalho: { ...CABECALHO_VAZIO }, erros, avisos };
  }

  // ------------------------------------------------------------------ abas
  const lidas: LinhaLida[] = [];
  let sequencia = 0;

  for (const ws of wb.worksheets) {
    const nome = ws.name;
    if (nome === '_META' || nome === '_ERROS') continue;

    const doLayout = layout.registro(nome);
    if (!doLayout && !RE_CODIGO_REGISTRO.test(nome)) {
      // Aba renomeada ou de rascunho: avisa e ignora (spec 5.4).
      avisos.push({
        severidade: 'aviso',
        aba: nome,
        mensagem: `Aba "${nome}" não corresponde a nenhum registro; ignorada.`,
      });
      continue;
    }
    if (!doLayout) {
      // Codigo de registro fora do dicionario: o bloco I tem leiaute em ADE
      // separado, e to-excel escreveu colunas posicionais. Ler assim mesmo,
      // senao a volta perde a linha.
      avisos.push({
        severidade: 'aviso',
        aba: nome,
        mensagem: `Registro "${nome}" não consta no leiaute; colunas lidas por posição.`,
      });
    }

    // --- cabecalho: mapeia NOME -> indice de coluna ------------------------
    const primeira = ws.getRow(1);
    const indicePorNome = new Map<string, number>();
    primeira.eachCell({ includeEmpty: false }, (celula, coluna) => {
      const cabecalho = textoDaCelula(celula.value).trim();
      if (cabecalho && !indicePorNome.has(cabecalho)) indicePorNome.set(cabecalho, coluna);
    });

    const colId = indicePorNome.get(COL_ID);
    const colPai = indicePorNome.get(COL_PAI);
    const colOrdem = indicePorNome.get(COL_ORDEM);
    if (colOrdem === undefined) {
      erros.push({
        severidade: 'erro',
        aba: nome,
        mensagem: `Aba sem a coluna ${COL_ORDEM}, que é a chave da reconstrução.`,
      });
      continue;
    }

    // Campos do registro, na ordem do leiaute, com a coluna onde cada um
    // esta. Reordenar colunas na planilha nao muda nada aqui.
    const campos: CampoLayout[] = doLayout ? doLayout.campos : [];
    const colunaDoCampo: (number | undefined)[] = [];
    if (doLayout) {
      campos.forEach((campo, i) => {
        colunaDoCampo[i] = indicePorNome.get(campo.nome);
        if (colunaDoCampo[i] === undefined) {
          avisos.push({
            severidade: 'aviso',
            aba: nome,
            campo: campo.nome,
            mensagem: `Coluna "${campo.nome}" não encontrada; campo sairá vazio.`,
          });
        }
      });
    } else {
      // posicional: REG, CAMPO_02, CAMPO_03...
      const posicoes: number[] = [];
      const reg = indicePorNome.get('REG');
      if (reg !== undefined) posicoes[0] = reg;
      for (const [cabecalho, coluna] of indicePorNome) {
        const m = RE_CAMPO_GENERICO.exec(cabecalho);
        if (m) posicoes[Number(m[1]) - 1] = coluna;
      }
      for (let i = 0; i < posicoes.length; i++) colunaDoCampo[i] = posicoes[i];
    }
    const totalCampos = doLayout ? campos.length : colunaDoCampo.length;

    // --- linhas de dados ---------------------------------------------------
    // A linha 2 pode ser a de descricao (flag incluirDescricoes do to-excel):
    // ela nao tem _ordem preenchido.
    for (let r = 2; r <= ws.rowCount; r++) {
      const linha = ws.getRow(r);
      const ordemBruta = textoDaCelula(linha.getCell(colOrdem).value).trim();
      const idBruto = colId ? textoDaCelula(linha.getCell(colId).value).trim() : '';

      const valores: string[] = [];
      let temConteudo = false;
      for (let i = 0; i < totalCampos; i++) {
        const coluna = colunaDoCampo[i];
        const campo = doLayout ? campos[i] : undefined;
        const valor =
          coluna === undefined
            ? ''
            : valorDoCampo(linha.getCell(coluna), campo, (mensagem, campoNome) =>
                avisos.push({
                  severidade: 'aviso',
                  aba: nome,
                  linha: r,
                  registro: nome,
                  campo: campoNome,
                  mensagem,
                }),
              );
        valores[i] = valor;
        if (valor !== '') temConteudo = true;
      }

      // Linha de descricao ou linha em branco que o usuario deixou.
      if (!temConteudo && ordemBruta === '') continue;
      if (ordemBruta === '' && idBruto === '' && !temConteudo) continue;

      const reg = valores[0] ?? nome;
      if (reg === '') {
        avisos.push({
          severidade: 'aviso',
          aba: nome,
          linha: r,
          mensagem: 'Linha sem REG; ignorada.',
        });
        continue;
      }

      const ordem = ordemBruta === '' ? null : Number(ordemBruta);
      lidas.push({
        id: idBruto || `x${String(++sequencia).padStart(6, '0')}`,
        paiDeclarado: colPai ? textoDaCelula(linha.getCell(colPai).value).trim() || null : null,
        ordem: ordem !== null && Number.isFinite(ordem) ? ordem : null,
        reg,
        valores,
        aba: nome,
        linhaPlanilha: r,
      });
    }
  }

  // --------------------------------------------------- ordenacao das linhas
  // Linha nova sem _ordem entra logo depois da ultima do mesmo registro
  // (spec 5.4, passo 5). Sem isso ela iria para o fim do arquivo, fora do
  // bloco, e o PVA recusaria.
  const ultimaOrdemPorReg = new Map<string, number>();
  for (const l of lidas) {
    if (l.ordem !== null) {
      const atual = ultimaOrdemPorReg.get(l.reg) ?? -Infinity;
      if (l.ordem > atual) ultimaOrdemPorReg.set(l.reg, l.ordem);
    }
  }
  const maiorOrdem = lidas.reduce((m, l) => Math.max(m, l.ordem ?? 0), 0);

  let desempate = 0;
  const comChave = lidas.map((l) => {
    if (l.ordem !== null) return { linha: l, chave: l.ordem, sub: 0 };
    const base = ultimaOrdemPorReg.get(l.reg) ?? maiorOrdem;
    avisos.push({
      severidade: 'aviso',
      aba: l.aba,
      linha: l.linhaPlanilha,
      registro: l.reg,
      mensagem: `Linha nova sem ${COL_ORDEM}; inserida após a última ${l.reg}.`,
    });
    return { linha: l, chave: base, sub: ++desempate };
  });
  comChave.sort((a, b) => a.chave - b.chave || a.sub - b.sub);

  // ------------------------------------------------------------- hierarquia
  const nos: NoRegistro[] = [];
  const idsPresentes = new Set(comChave.map((c) => c.linha.id));
  const pilha: NoRegistro[] = [];
  let nivelAnterior = 0;

  comChave.forEach(({ linha }, indice) => {
    const nivel = nivelDe(linha.reg, layout, nivelAnterior);

    let paiId: string | null = null;
    if (linha.paiDeclarado && idsPresentes.has(linha.paiDeclarado)) {
      // Vinculo original preservado.
      paiId = linha.paiDeclarado;
    } else if (linha.paiDeclarado && !idsPresentes.has(linha.paiDeclarado)) {
      // O pai foi apagado na planilha e o filho ficou: erro bloqueante
      // (spec 5.4). Gerar assim produziria arquivo que o PVA recusa.
      erros.push({
        severidade: 'erro',
        aba: linha.aba,
        linha: linha.linhaPlanilha,
        registro: linha.reg,
        mensagem:
          `Registro filho órfão: o pai ${linha.paiDeclarado} não está mais na planilha. ` +
          `Apagar um registro pai exige apagar os filhos.`,
      });
    } else if (nivel > 0) {
      // Linha nova, sem _pai: infere pela pilha, como o parser.
      const pai = pilha[nivel - 1];
      if (pai) paiId = pai.id;
    }

    const no: NoRegistro = {
      id: linha.id,
      paiId,
      reg: linha.reg,
      nivel,
      ordem: indice + 1,
      valores: linha.valores,
      linhaOriginal: linha.linhaPlanilha,
    };

    pilha.length = Math.min(pilha.length, nivel);
    pilha[nivel] = no;
    nivelAnterior = nivel;
    nos.push(no);
  });

  // ---------------------------------------- campo obrigatorio vazio: bloqueia
  for (const no of nos) {
    const doLayout = layout.registro(no.reg);
    if (!doLayout) continue;
    for (const campo of doLayout.campos) {
      if (campo.obrigatorio && (no.valores[campo.num - 1] ?? '') === '') {
        erros.push({
          severidade: 'erro',
          aba: no.reg,
          linha: no.linhaOriginal,
          registro: no.reg,
          campo: campo.nome,
          mensagem: 'Campo obrigatório vazio.',
        });
      }
    }
  }

  return { nos, cabecalho: extraiCabecalho(nos, meta), erros, avisos };
}

/** Cabecalho do 0000; cai na _META se o 0000 nao vier. */
function extraiCabecalho(
  nos: NoRegistro[],
  meta: Map<string, string>,
): ResultadoParse['cabecalho'] {
  const no = nos.find((n) => n.reg === '0000');
  if (no) {
    return {
      dtIni: no.valores[5] ?? '',
      dtFin: no.valores[6] ?? '',
      razaoSocial: no.valores[7] ?? '',
      cnpj: no.valores[8] ?? '',
    };
  }
  const periodo = (meta.get('periodo') ?? '').split(' a ');
  return {
    dtIni: periodo[0]?.trim() ?? '',
    dtFin: periodo[1]?.trim() ?? '',
    razaoSocial: meta.get('razao_social') ?? '',
    cnpj: meta.get('cnpj') ?? '',
  };
}
