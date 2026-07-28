// Reduz um arquivo da EFD-Contribuicoes a uma fixture pequena que ainda
// exercita todos os tipos de registro do original.
//
// Como funciona:
//
//  1. mantem a PRIMEIRA ocorrencia de cada tipo de registro, mais toda a
//     cadeia de ancestrais dessa linha. Registro filho exige o pai
//     imediatamente acima (regra inviolavel 10), entao guardar um C170 sem
//     o C100 geraria arquivo invalido;
//  2. preserva a ordem original das linhas, o que mantem a ordem dos blocos
//     (0 -> A -> C -> D -> F -> I -> M -> P -> 1 -> 9) de graca;
//  3. RECALCULA X990, 9900, 9990 e 9999, porque o subconjunto tem outra
//     contagem de linhas.
//
// O recalculo aqui e deliberadamente independente de lib/sped/totalizers.ts:
// serve de contraprova para a implementacao de F1-T6.
//
// Uso:
//   node scripts/reduz_fixture.mjs entrada.txt saida.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error('uso: node scripts/reduz_fixture.mjs <entrada.txt> <saida.txt>');
  process.exit(1);
}

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dic = JSON.parse(readFileSync(join(RAIZ, 'data', 'layout_efd_contribuicoes.json'), 'utf-8'));

const ORDEM_BLOCOS = ['0', 'A', 'C', 'D', 'F', 'I', 'M', 'P', '1', '9'];

/** Nivel hierarquico do registro. O dicionario nem sempre traz; os
 *  registros de abertura e encerramento de bloco tem nivel fixo. */
function nivelDe(reg) {
  if (reg === '0000' || reg === '9999') return 0;
  if (/^.001$/.test(reg) || /^.990$/.test(reg)) return 1;
  const n = dic.registros[reg]?.nivel;
  return typeof n === 'number' ? n : null;
}

const linhas = readFileSync(entrada).toString('latin1').split('\r\n').filter((l) => l !== '');
const registros = linhas.map((l) => l.slice(1, -1).split('|')[0]);

// --- 1. ancestrais de cada linha, por pilha de niveis ---------------------
const ancestrais = new Array(linhas.length).fill(null).map(() => []);
const pilha = [];
let ultimoNivel = 0;
for (let i = 0; i < linhas.length; i++) {
  let nivel = nivelDe(registros[i]);
  if (nivel === null) nivel = ultimoNivel; // desconhecido: irmao do anterior
  pilha.length = Math.min(pilha.length, nivel);
  ancestrais[i] = [...pilha];
  pilha[nivel] = i;
  ultimoNivel = nivel;
}

// --- 2. selecao: primeira ocorrencia de cada tipo + ancestrais ------------
const manter = new Set();
const jaVisto = new Set();
for (let i = 0; i < linhas.length; i++) {
  const reg = registros[i];
  // o bloco 9 inteiro e reconstruido; X990 tambem
  if (reg.startsWith('9') || /^.990$/.test(reg)) continue;
  if (jaVisto.has(reg)) continue;
  jaVisto.add(reg);
  manter.add(i);
  for (const a of ancestrais[i]) manter.add(a);
}

const selecionadas = [...manter].sort((a, b) => a - b).map((i) => linhas[i]);

// --- 3. reconstrucao dos totalizadores ------------------------------------
const blocoDe = (reg) => reg[0];
const porBloco = new Map();
for (const l of selecionadas) {
  const b = blocoDe(l.slice(1, -1).split('|')[0]);
  if (!porBloco.has(b)) porBloco.set(b, []);
  porBloco.get(b).push(l);
}

const corpo = [];
for (const b of ORDEM_BLOCOS) {
  if (b === '9' || !porBloco.has(b)) continue;
  const doBloco = porBloco.get(b);
  corpo.push(...doBloco);
  // X990: total de linhas do bloco INCLUINDO a propria linha de encerramento
  corpo.push(`|${b}990|${doBloco.length + 1}|`);
}

// tipos presentes no arquivo final, na ordem de aparicao; o bloco 9
// acrescenta 9001, 9900, 9990 e 9999
const contagem = new Map();
for (const l of corpo) {
  const r = l.slice(1, -1).split('|')[0];
  contagem.set(r, (contagem.get(r) ?? 0) + 1);
}
const linha9001 = linhas.find((l) => l.startsWith('|9001|')) ?? '|9001|0|';
contagem.set('9001', 1);

const tipos = [...contagem.keys()];
const totalTipos = tipos.length + 3; // + 9900, 9990, 9999
contagem.set('9900', totalTipos);
contagem.set('9990', 1);
contagem.set('9999', 1);

const bloco9 = [linha9001];
for (const reg of [...contagem.keys()]) {
  bloco9.push(`|9900|${reg}|${contagem.get(reg)}|`);
}
// 9990 conta todas as linhas do bloco 9, incluindo ela mesma e a 9999
bloco9.push(`|9990|${bloco9.length + 2}|`);
const total = corpo.length + bloco9.length + 1;
bloco9.push(`|9999|${total}|`);

const final = [...corpo, ...bloco9];
writeFileSync(saida, Buffer.from(final.join('\r\n') + '\r\n', 'latin1'));

console.log(`linhas: ${linhas.length} -> ${final.length}`);
console.log(`tipos de registro: ${new Set(registros).size} -> ${new Set(final.map((l) => l.slice(1, -1).split('|')[0])).size}`);
console.log(`bytes: ${readFileSync(entrada).length} -> ${readFileSync(saida).length}`);
