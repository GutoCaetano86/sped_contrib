// Recalculo de X990 / 9900 / 9990 / 9999. Ver docs/SPEC.md secoes 2.3 e 5.5.
//
// Sem isto o PVA recusa o arquivo: e a regra de negocio mais importante do
// produto, porque toda edicao na planilha muda a contagem de linhas.
//
// A semantica abaixo foi MEDIDA contra dois arquivos aprovados pelo PVA, nao
// deduzida: o de 138.100 linhas tem 74 tipos de registro, 74 linhas de 9900,
// e a propria linha do 9900 declara 74 — logo o 9900 se conta entre os
// tipos. O 9990 do mesmo arquivo declara 77 = 9001 + 74x9900 + 9990 + 9999.
import type { NoRegistro } from './types';

/** Encerramento de bloco: 0990, A990, C990 ... 1990 e o proprio 9990. */
const RE_ENCERRAMENTO_BLOCO = /^[0-9A-Z]990$/;

const ehTotalizador = (reg: string): boolean =>
  reg === '9900' || reg === '9999' || RE_ENCERRAMENTO_BLOCO.test(reg);

/**
 * Nivel dos totalizadores, pela convencao estrutural do SPED. Fixo porque
 * `recalcularTotalizadores` nao recebe o dicionario — e nem precisa: estes
 * quatro registros tem nivel constante em todo o leiaute.
 */
function nivelDoTotalizador(reg: string): number {
  if (reg === '9999') return 0;
  if (reg === '9900') return 2;
  return 1; // X990, incluindo 9990
}

/** Ids proprios (`t`) para nao colidir com os do parser (`r`). */
const idCriado = (sequencia: number): string => `t${String(sequencia).padStart(6, '0')}`;

/**
 * Recalcula X990, 9900, 9990 e 9999.
 *
 * Descarta os totalizadores que vierem na entrada e recria todos, porque
 * confiar no que veio da planilha e justamente o erro que o produto existe
 * para evitar (spec 11, decisao 5).
 *
 * @param nos arvore de registros; nao e alterada
 */
export function recalcularTotalizadores(nos: NoRegistro[]): NoRegistro[] {
  if (nos.length === 0) return [];

  const ordenados = [...nos].sort((a, b) => a.ordem - b.ordem);
  const preservados = ordenados.filter((n) => !ehTotalizador(n.reg));

  // A ORDEM em que as linhas 9900 citam os registros nao vem da spec: e
  // convencao de quem gerou o arquivo. Medido no arquivo real aprovado pelo
  // PVA, ele ordena por codigo dentro do bloco (C100, C120, C170 — sendo que
  // o C120 aparece fisicamente depois do C505) e deixa a entrada do proprio
  // 9900 por ultimo, depois da 9990 e da 9999.
  //
  // Nao da para deduzir essa ordem, entao preservamos a que o arquivo ja
  // declarou. Sem isso o round-trip byte a byte da secao 9.2 e impossivel em
  // arquivo de terceiro. Quando nao ha 9900 na entrada, cai na ordem de
  // aparicao que a spec 5.5 descreve.
  const ordemDeclarada = ordenados
    .filter((n) => n.reg === '9900')
    .map((n) => n.valores[1] ?? '')
    .filter((reg) => reg !== '');

  // Agrupa por bloco mantendo a ordem em que os blocos aparecem. Nao impomos
  // a ordem canonica 0-A-C-D-F-I-M-P-1-9: reordenar bloco seria alterar o
  // arquivo do usuario, e apontar bloco fora de ordem cabe ao validador.
  const porBloco = new Map<string, NoRegistro[]>();
  for (const no of preservados) {
    const bloco = no.reg[0] ?? '';
    const lista = porBloco.get(bloco);
    if (lista) lista.push(no);
    else porBloco.set(bloco, [no]);
  }
  const doBloco9 = porBloco.get('9') ?? [];
  porBloco.delete('9');

  let sequencia = 0;
  const criar = (reg: string, ...resto: string[]): NoRegistro => ({
    id: idCriado(++sequencia),
    paiId: null,
    reg,
    nivel: nivelDoTotalizador(reg),
    ordem: 0, // definido no fim, junto com todos
    valores: [reg, ...resto],
    linhaOriginal: 0,
  });

  // --- corpo: cada bloco seguido do seu encerramento ----------------------
  // X990 conta o total de linhas do bloco INCLUINDO a propria linha.
  const corpo: NoRegistro[] = [];
  for (const [bloco, doBlocoAtual] of porBloco) {
    corpo.push(...doBlocoAtual);
    corpo.push(criar(`${bloco}990`, String(doBlocoAtual.length + 1)));
  }

  // --- tipos presentes, na ordem de aparicao ------------------------------
  // O bloco 9 acrescenta exatamente tres tipos (9900, 9990, 9999) alem dos
  // registros que ja vieram nele, entao da para contar sem circularidade.
  const presentes = new Set<string>([
    ...corpo.map((n) => n.reg),
    ...doBloco9.map((n) => n.reg),
    '9900',
    '9990',
    '9999',
  ]);

  const tipos: string[] = [];
  const vistos = new Set<string>();
  const anotar = (reg: string) => {
    if (presentes.has(reg) && !vistos.has(reg)) {
      vistos.add(reg);
      tipos.push(reg);
    }
  };
  // primeiro a ordem que o arquivo declarou, descartando o que sumiu...
  for (const reg of ordemDeclarada) anotar(reg);
  // ...depois o que for novo, na ordem de aparicao
  for (const no of corpo) anotar(no.reg);
  for (const no of doBloco9) anotar(no.reg);
  anotar('9900');
  anotar('9990');
  anotar('9999');

  const ocorrencias = new Map<string, number>();
  for (const no of [...corpo, ...doBloco9]) {
    ocorrencias.set(no.reg, (ocorrencias.get(no.reg) ?? 0) + 1);
  }
  // O 9900 se conta: ha uma linha 9900 por tipo, entao a quantidade de
  // linhas 9900 e a propria quantidade de tipos.
  ocorrencias.set('9900', tipos.length);
  ocorrencias.set('9990', 1);
  ocorrencias.set('9999', 1);

  // --- bloco 9 ------------------------------------------------------------
  const bloco9: NoRegistro[] = [...doBloco9];
  for (const reg of tipos) {
    bloco9.push(criar('9900', reg, String(ocorrencias.get(reg) ?? 0)));
  }
  // 9990 conta todas as linhas do bloco 9, incluindo ela mesma e a 9999.
  bloco9.push(criar('9990', String(bloco9.length + 2)));
  // 9999 e o total de linhas do arquivo.
  bloco9.push(criar('9999', String(corpo.length + bloco9.length + 1)));

  // --- montagem final -----------------------------------------------------
  const final = [...corpo, ...bloco9];

  // `ordem` de 1 a N e hierarquia refeita: os totalizadores criados entraram
  // sem pai, e as linhas preservadas mudaram de posicao.
  const pilha: NoRegistro[] = [];
  return final.map((no, indice) => {
    const nivel = no.nivel;
    pilha.length = Math.min(pilha.length, nivel);
    const pai = nivel > 0 ? pilha[nivel - 1] : undefined;
    const resultado: NoRegistro = {
      ...no,
      ordem: indice + 1,
      paiId: pai ? pai.id : null,
    };
    pilha[nivel] = resultado;
    return resultado;
  });
}
