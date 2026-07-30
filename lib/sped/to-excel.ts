// AST -> XLSX. Ver docs/SPEC.md secao 5.3.
//
// Regra inegociavel: TODA celula de dados sai formatada como TEXTO
// (numFmt '@'). Sem isso o Excel transforma "00123" em 123 e "0,65" em
// numero com ponto, e o TXT reconvertido e recusado pelo PVA.
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import type { CampoLayout, Layout, NoRegistro, ResultadoParse } from './types';

export interface OpcoesExcel {
  /** Linha 2 com a descricao resumida de cada campo. */
  incluirDescricoes?: boolean;
  /** Nome do arquivo TXT de origem, guardado na aba _META. */
  arquivoOrigem?: string;
  /** SHA-256 do arquivo de origem, para detectar Excel de outro arquivo. */
  hashOrigem?: string;
}

const AZUL_CABECALHO = 'FF1F4E79';
const CINZA_META = 'FFD9D9D9';
/** Cabecalho das colunas derivadas — cor diferente para o usuario ver que
 *  aquilo e contexto do pai, nao campo do registro. */
const VERDE_DERIVADA = 'FF375623';

/** Colunas de controle, antes dos campos do leiaute. */
const CONTROLE = ['_id', '_pai', '_ordem'] as const;

/**
 * Campos que identificam um registro para um humano, em ordem de utilidade.
 *
 * Servem para montar as colunas de CONTEXTO na aba de um registro filho: sem
 * elas o usuario abre a aba C170 e nao tem como saber a qual nota fiscal cada
 * item pertence — o vinculo existe so no `_pai`, que e um id opaco e oculto.
 */
const CAMPOS_DE_CONTEXTO = [
  'CNPJ',
  'CPF',
  'NUM_DOC',
  'COD_PART',
  'SER',
  'DT_DOC',
  'COD_MOD',
  'COD_ITEM',
] as const;

/** Quantas colunas de contexto puxar de cada ancestral. */
const MAX_CONTEXTO_POR_ANCESTRAL = 4;

/**
 * Toda coluna derivada leva o prefixo do registro de origem: _C100_NUM_DOC.
 *
 * O prefixo `_` e o que faz o from-excel.ts ignora-la ao remontar o TXT —
 * nenhum campo do leiaute comeca com sublinhado. Sem ele, uma coluna chamada
 * `CNPJ` na aba do C170 colidiria com o campo `CNPJ` de verdade (o nome
 * aparece em 17 registros), e o mapeamento por nome erraria o campo.
 */
const nomeDeContexto = (reg: string, campo: string): string => `_${reg}_${campo}`;

interface ColunaContexto {
  /** Cabecalho na planilha. */
  nome: string;
  /** Posicao do ancestral na cadeia, do mais externo para o pai direto. */
  posicaoAncestral: number;
  /** Registro de onde o valor vem, para nao pegar valor de ancestral trocado. */
  reg: string;
  /** Numero do campo no leiaute do ancestral. */
  num: number;
}

/** `min(max(nome.length + 2, 12), 40)`, conforme a spec 5.3. */
const larguraDe = (nome: string): number => Math.min(Math.max(nome.length + 2, 12), 40);

/** Comentario do cabecalho: "C 004* · obrigatório". */
function anotacaoDoCampo(campo: CampoLayout): string {
  const tamanho = campo.tamanho > 0 ? String(campo.tamanho).padStart(3, '0') : '-';
  const fixo = campo.tamanho_fixo ? '*' : '';
  const decimais = campo.decimais > 0 ? ` · ${campo.decimais} decimais` : '';
  const obrigatorio = campo.obrigatorio ? 'obrigatório' : 'opcional';
  return `${campo.tipo} ${tamanho}${fixo}${decimais} · ${obrigatorio}\n${campo.descricao}`;
}

/**
 * Registro fora do dicionario (o bloco I tem leiaute em ADE separado) nao tem
 * nome de campo. Em vez de descartar a linha — o que perderia dado do
 * usuario —, geramos cabecalhos posicionais.
 */
function camposGenericos(nos: NoRegistro[]): CampoLayout[] {
  const maior = nos.reduce((m, n) => Math.max(m, n.valores.length), 0);
  return Array.from({ length: maior }, (_, i) => ({
    num: i + 1,
    nome: i === 0 ? 'REG' : `CAMPO_${String(i + 1).padStart(2, '0')}`,
    descricao: 'Registro fora do dicionario de leiaute; coluna posicional.',
    tipo: 'C' as const,
    tamanho: 0,
    tamanho_fixo: false,
    decimais: 0,
    obrigatorio: false,
  }));
}

/** Agrupa os nos por tipo de registro, na ordem oficial dos blocos. */
function agruparPorRegistro(nos: NoRegistro[], layout: Layout): [string, NoRegistro[]][] {
  const porTipo = new Map<string, NoRegistro[]>();
  for (const no of [...nos].sort((a, b) => a.ordem - b.ordem)) {
    const lista = porTipo.get(no.reg);
    if (lista) lista.push(no);
    else porTipo.set(no.reg, [no]);
  }

  const ordemBloco = new Map(layout.ordem_blocos.map((b, i) => [b, i]));
  const primeiraAparicao = new Map([...porTipo.keys()].map((reg, i) => [reg, i]));

  return [...porTipo.entries()].sort(([a], [b]) => {
    const blocoA = ordemBloco.get(a[0] ?? '') ?? 99;
    const blocoB = ordemBloco.get(b[0] ?? '') ?? 99;
    if (blocoA !== blocoB) return blocoA - blocoB;
    return (primeiraAparicao.get(a) ?? 0) - (primeiraAparicao.get(b) ?? 0);
  });
}

/** Ancestrais de um no, do mais externo para o pai direto. */
function ancestraisDe(no: NoRegistro, porId: Map<string, NoRegistro>): NoRegistro[] {
  const cadeia: NoRegistro[] = [];
  let atual = no.paiId ? porId.get(no.paiId) : undefined;
  // guarda contra ciclo: arvore corrompida nao pode travar a geracao
  let voltas = 0;
  while (atual && voltas++ < 10) {
    cadeia.unshift(atual);
    atual = atual.paiId ? porId.get(atual.paiId) : undefined;
  }
  return cadeia;
}

/**
 * Monta as colunas de contexto da aba, a partir da cadeia de ancestrais.
 *
 * A cadeia vem do primeiro no do grupo: registro de um tipo tem sempre o
 * mesmo nivel, entao a forma da cadeia se repete. Linha cujo ancestral for de
 * outro registro sai com a celula vazia, e nao com valor de outro documento.
 */
function colunasDeContexto(
  nos: NoRegistro[],
  porId: Map<string, NoRegistro>,
  layout: Layout,
): ColunaContexto[] {
  const primeiro = nos[0];
  if (!primeiro) return [];

  const cadeia = ancestraisDe(primeiro, porId);
  const colunas: ColunaContexto[] = [];
  const jaUsado = new Set<string>();

  cadeia.forEach((ancestral, posicao) => {
    // O 0000 e o unico ancestral de nivel 0 e o CNPJ dele e o mesmo em todo o
    // arquivo: repetir isso em 100 mil linhas nao informa nada.
    if (ancestral.nivel === 0) return;
    const doLayout = layout.registro(ancestral.reg);
    if (!doLayout) return;
    let quantos = 0;
    for (const nome of CAMPOS_DE_CONTEXTO) {
      if (quantos >= MAX_CONTEXTO_POR_ANCESTRAL) break;
      const campo = doLayout.campoPorNome.get(nome);
      if (!campo) continue;
      const cabecalho = nomeDeContexto(ancestral.reg, nome);
      if (jaUsado.has(cabecalho)) continue;
      jaUsado.add(cabecalho);
      colunas.push({
        nome: cabecalho,
        posicaoAncestral: posicao,
        reg: ancestral.reg,
        num: campo.num,
      });
      quantos++;
    }
  });

  return colunas;
}

/**
 * Gera o XLSX com uma aba por tipo de registro.
 *
 * Usa o WorkbookWriter do exceljs: um TXT de 50 MB vira centenas de milhares
 * de linhas, e montar a planilha inteira em memoria estouraria a serverless.
 */
export async function gerarExcel(
  res: ResultadoParse,
  layout: Layout,
  opcoes: OpcoesExcel = {},
): Promise<Buffer> {
  const saida = new PassThrough();
  const pedacos: Buffer[] = [];
  saida.on('data', (pedaco: Buffer) => pedacos.push(Buffer.from(pedaco)));
  const terminou = new Promise<void>((resolve, reject) => {
    saida.on('end', () => resolve());
    saida.on('error', reject);
  });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: saida,
    useStyles: true,
    useSharedStrings: true,
  });
  wb.creator = 'SPED Converter';
  wb.created = new Date();

  // Indices para as colunas de contexto: pai por id, e "qual instancia do
  // registro pai" para o usuario ter um numero estavel de agrupamento.
  const porId = new Map(res.nos.map((no) => [no.id, no]));
  const indiceNoTipo = new Map<string, number>();
  const contador = new Map<string, number>();
  for (const no of [...res.nos].sort((a, b) => a.ordem - b.ordem)) {
    const n = (contador.get(no.reg) ?? 0) + 1;
    contador.set(no.reg, n);
    indiceNoTipo.set(no.id, n);
  }

  escreveMeta(wb, res, opcoes);
  for (const [reg, nos] of agruparPorRegistro(res.nos, layout)) {
    escreveRegistro(wb, reg, nos, layout, opcoes, porId, indiceNoTipo);
  }
  escreveErros(wb, res);

  await wb.commit();
  await terminou;
  return Buffer.concat(pedacos);
}

/**
 * Aba _META: o contrato de reconversao. Se ela sumir ou o `layout` divergir,
 * from-excel.ts recusa o arquivo (spec 3.4).
 */
function escreveMeta(
  wb: ExcelJS.stream.xlsx.WorkbookWriter,
  res: ResultadoParse,
  opcoes: OpcoesExcel,
): void {
  const ws = wb.addWorksheet('_META');
  ws.columns = [
    { key: 'chave', width: 22 },
    { key: 'valor', width: 60 },
  ];

  const { cabecalho } = res;
  const periodo =
    cabecalho.dtIni && cabecalho.dtFin ? `${cabecalho.dtIni} a ${cabecalho.dtFin}` : '';

  const linhas: [string, string][] = [
    ['layout', 'EFD-Contribuicoes'],
    ['versao_guia', '1.35'],
    ['arquivo_origem', opcoes.arquivoOrigem ?? ''],
    ['cnpj', cabecalho.cnpj],
    ['razao_social', cabecalho.razaoSocial],
    ['periodo', periodo],
    ['total_linhas', String(res.nos.length)],
    ['gerado_em', new Date().toISOString()],
    ['hash_origem', opcoes.hashOrigem ?? ''],
  ];

  for (const [chave, valor] of linhas) {
    const linha = ws.addRow([chave, valor]);
    for (const celula of [linha.getCell(1), linha.getCell(2)]) {
      celula.numFmt = '@';
      celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_META } };
      celula.protection = { locked: true };
    }
    linha.getCell(1).font = { bold: true };
    linha.commit();
  }

  ws.commit();
}

function escreveRegistro(
  wb: ExcelJS.stream.xlsx.WorkbookWriter,
  reg: string,
  nos: NoRegistro[],
  layout: Layout,
  opcoes: OpcoesExcel,
  porId: Map<string, NoRegistro>,
  indiceNoTipo: Map<string, number>,
): void {
  const doLayout = layout.registro(reg);
  const campos = doLayout ? doLayout.campos : camposGenericos(nos);
  const contexto = colunasDeContexto(nos, porId, layout);

  // As derivadas so entram quando ha contexto a mostrar. Aba de abertura de
  // bloco (C001, cujo pai e o 0000) nao ganha nada: o pai nao tem campo que
  // identifique documento, e coluna que repete o mesmo valor em toda linha e
  // ruido. `_item_pai` acompanha o contexto porque e o que permite agrupar e
  // filtrar os filhos de um mesmo documento.
  const temPai = contexto.length > 0;
  const derivadas = temPai ? ['_item_pai', ...contexto.map((c) => c.nome)] : [];

  const ws = wb.addWorksheet(reg, {
    // Congela as colunas de controle e as derivadas: o usuario rola para a
    // direita sem perder de vista de qual documento e a linha.
    views: [
      { state: 'frozen', xSplit: CONTROLE.length + derivadas.length, ySplit: 1 },
    ],
  });

  ws.columns = [
    { key: '_id', width: 14, hidden: true, style: { numFmt: '@' } },
    { key: '_pai', width: 14, hidden: true, style: { numFmt: '@' } },
    // _ordem fica numerico de proposito: e a chave da reconstrucao e o
    // usuario precisa poder ordenar por ela na planilha. Como texto, "10"
    // viria antes de "2".
    { key: '_ordem', width: 10 },
    ...derivadas.map((nome) => ({
      key: nome,
      width: larguraDe(nome),
      style: { numFmt: '@' },
    })),
    ...campos.map((campo) => ({
      key: campo.nome,
      width: larguraDe(campo.nome),
      style: { numFmt: '@' },
    })),
  ];

  const inicioCampos = CONTROLE.length + derivadas.length;
  const totalColunas = inicioCampos + campos.length;
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: totalColunas },
  };

  // --- linha 1: cabecalho ---------------------------------------------------
  const cabecalho = ws.addRow([...CONTROLE, ...derivadas, ...campos.map((c) => c.nome)]);
  cabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CABECALHO } };

  derivadas.forEach((nome, i) => {
    const celula = cabecalho.getCell(CONTROLE.length + i + 1);
    // Verde escuro distingue o que e contexto do que e campo do registro.
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_DERIVADA } };
    celula.note =
      nome === '_item_pai'
        ? 'Número da instância do registro pai. Coluna derivada: editar aqui não altera o TXT.'
        : `Contexto herdado do registro ${nome.split('_')[1]}. Coluna derivada: ` +
          `editar aqui não altera o TXT — corrija no registro de origem.`;
  });
  campos.forEach((campo, i) => {
    cabecalho.getCell(inicioCampos + i + 1).note = anotacaoDoCampo(campo);
  });
  cabecalho.commit();

  // --- linha 2: descricao, opcional ----------------------------------------
  if (opcoes.incluirDescricoes) {
    const descricoes = ws.addRow([
      ...CONTROLE.map(() => ''),
      ...derivadas.map(() => 'derivado'),
      ...campos.map((c) => c.descricao.slice(0, 120)),
    ]);
    descricoes.font = { italic: true, color: { argb: 'FF808080' } };
    descricoes.commit();
  }

  // --- dados ----------------------------------------------------------------
  for (const no of nos) {
    const ancestrais = derivadas.length > 0 ? ancestraisDe(no, porId) : [];
    const valoresDerivados = temPai
      ? [
          // instancia do pai direto
          no.paiId ? (indiceNoTipo.get(no.paiId) ?? '') : '',
          ...contexto.map((coluna) => {
            const ancestral = ancestrais[coluna.posicaoAncestral];
            // Cadeia diferente da esperada: celula vazia, nunca valor de
            // outro documento.
            if (!ancestral || ancestral.reg !== coluna.reg) return '';
            return ancestral.valores[coluna.num - 1] ?? '';
          }),
        ]
      : [];

    const linha = ws.addRow([
      no.id,
      no.paiId ?? '',
      no.ordem,
      ...valoresDerivados,
      ...campos.map((_, i) => no.valores[i] ?? ''),
    ]);

    // Texto em toda celula de dado. A regra vale por celula, e nao so pelo
    // estilo da coluna, porque o Excel respeita o formato da celula quando o
    // usuario cola valor por cima.
    for (let c = 1; c <= totalColunas; c++) {
      if (c === 3) continue; // _ordem e numerico
      if (temPai && c === CONTROLE.length + 1) continue; // _item_pai e numerico
      linha.getCell(c).numFmt = '@';
    }
    linha.getCell(1).protection = { locked: true };
    linha.getCell(2).protection = { locked: true };
    // Derivadas travadas: o valor vem do registro pai, editar aqui nao faria
    // efeito e so confundiria.
    for (let i = 0; i < derivadas.length; i++) {
      linha.getCell(CONTROLE.length + i + 1).protection = { locked: true };
    }
    linha.commit();
  }

  ws.commit();
}

/** Aba _ERROS, so quando ha o que mostrar (spec 5.3). */
function escreveErros(wb: ExcelJS.stream.xlsx.WorkbookWriter, res: ResultadoParse): void {
  const ocorrencias = [...res.erros, ...res.avisos];
  if (ocorrencias.length === 0) return;

  const ws = wb.addWorksheet('_ERROS', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { key: 'severidade', width: 12 },
    { key: 'linha', width: 10 },
    { key: 'registro', width: 12 },
    { key: 'campo', width: 24 },
    { key: 'mensagem', width: 80 },
  ];

  const cabecalho = ws.addRow(['severidade', 'linha', 'registro', 'campo', 'mensagem']);
  cabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CABECALHO } };
  cabecalho.commit();

  for (const o of ocorrencias) {
    ws.addRow([o.severidade, o.linha ?? '', o.registro ?? '', o.campo ?? '', o.mensagem]).commit();
  }

  ws.commit();
}
