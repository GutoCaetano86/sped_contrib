// Compara os nomes de campo do dicionario com duas transcricoes
// independentes do leiaute, feitas pelo autor em projetos anteriores:
//
//   JS   Pagina-Converter-Sped/js/script.js   (arrays headersR<REG>)
//   XLSM EFDContrib.xlsm                      (linha 2 de cada aba)
//
// ATENCAO — estas fontes NAO sao autoridade. Elas foram construidas sobre
// uma versao MAIS NOVA do leiaute: o M210 delas tem VL_AJUS_ACRES_BC_PIS,
// VL_AJUS_REDUC_BC_PIS e VL_BC_CONT_AJUS, que nao existem no M210 do Guia
// Pratico v1.35, alvo deste projeto. Aplicar os nomes delas em massa
// injetaria campos de outra versao no dicionario.
//
// O uso correto e como DETECTOR: onde as duas concordam entre si e
// divergem do dicionario, ha algo para conferir no guia — pode ser
// corrupcao da extracao (que e o que se quer achar) ou deriva de versao
// (que se quer ignorar). Quem decide e o guia.
//
// Uso:  node scripts/conferencia/compara_fontes.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Caminhos dos projetos antigos, na maquina do autor. Ajuste se mudarem.
const JS = 'C:/Users/augus/OneDrive/Documentos/Programas/Pagina-Converter-Sped/js/script.js';
const XLSM = 'C:/Users/augus/OneDrive/Documentos/Programas/SPED Excel/AssociacaoEFDContrib (1)/EFDContrib.xlsm';
const XLSM_DIR = join(RAIZ, 'scripts', 'conferencia', '.xlsm');

const norm = (s) => (s ?? '').toString().replace(/\s+/g, '').toUpperCase();
const decod = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const igual = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------- XLSM
function lerXlsm() {
  if (!existsSync(XLSM)) return {};
  if (!existsSync(XLSM_DIR)) {
    mkdirSync(XLSM_DIR, { recursive: true });
    // .xlsm e um zip; so precisamos do workbook e das planilhas
    execFileSync('unzip', ['-o', '-q', XLSM, '-d', XLSM_DIR], { stdio: 'ignore' });
  }
  const wb = readFileSync(join(XLSM_DIR, 'xl/workbook.xml'), 'utf-8');
  const rels = readFileSync(join(XLSM_DIR, 'xl/_rels/workbook.xml.rels'), 'utf-8');
  const alvo = {};
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    alvo[m[1]] = m[2].replace(/^\/?xl\//, '');
  }
  const compartilhadas = [
    ...readFileSync(join(XLSM_DIR, 'xl/sharedStrings.xml'), 'utf-8').matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));

  const cabecalho = (arquivo) => {
    let xml;
    try {
      xml = readFileSync(join(XLSM_DIR, 'xl', arquivo), 'utf-8');
    } catch {
      return null;
    }
    const linha = xml.match(/<row[^>]*\br="2"[^>]*>([\s\S]*?)<\/row>/);
    if (!linha) return null;
    const cels = [];
    for (const c of linha[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tipo = (c[1].match(/t="([^"]+)"/) || [])[1];
      const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const texto =
        tipo === 's'
          ? compartilhadas[Number(v)] ?? ''
          : tipo === 'inlineStr'
            ? (c[2].match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] ?? ''
            : v ?? '';
      cels.push(decod(texto));
    }
    return cels;
  };

  const saida = {};
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    if (!/^[0-9A-Z]{4}$/.test(m[1])) continue;
    const cels = cabecalho(alvo[m[2]]);
    if (!cels) continue;
    // as colunas de controle do autor vem antes do REG
    const i = cels.findIndex((c) => norm(c) === 'REG');
    saida[m[1]] = (i >= 0 ? cels.slice(i) : cels).map(norm).filter(Boolean);
  }
  return saida;
}

// ------------------------------------------------------------------ JS
function lerJs() {
  if (!existsSync(JS)) return {};
  const src = readFileSync(JS, 'utf-8');
  const saida = {};
  for (const m of src.matchAll(/var\s+headersR([0-9A-Z]{4})\s*=\s*\[([^\]]*)\]/g)) {
    const itens = m[2]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    const i = itens.findIndex((t) => norm(t) === 'REG');
    saida[m[1]] = (i >= 0 ? itens.slice(i) : itens).map(norm);
  }
  return saida;
}

// --------------------------------------------------------------- saida
const js = lerJs();
const xlsm = lerXlsm();
const dic = JSON.parse(readFileSync(join(RAIZ, 'data', 'layout_efd_contribuicoes.json'), 'utf-8'));

const concordam = {};
for (const reg of Object.keys(js)) {
  if (xlsm[reg] && igual(js[reg], xlsm[reg])) concordam[reg] = js[reg];
}

console.log(`dicionario: ${Object.keys(dic.registros).length} registros`);
console.log(`JS: ${Object.keys(js).length} | XLSM: ${Object.keys(xlsm).length}`);
console.log(`fontes concordando entre si: ${Object.keys(concordam).length}\n`);

const batem = [];
const divergem = [];
for (const [reg, esperado] of Object.entries(concordam)) {
  const atual = dic.registros[reg]?.campos.map((c) => norm(c.nome));
  if (!atual) continue;
  (igual(atual, esperado) ? batem : divergem).push({ reg, esperado, atual });
}

console.log(`batem com o dicionario: ${batem.length}`);
console.log(`DIVERGEM (conferir no guia): ${divergem.length}\n`);

for (const d of divergem) {
  const dif = [];
  for (let i = 0; i < Math.max(d.esperado.length, d.atual.length); i++) {
    if (d.esperado[i] !== d.atual[i]) dif.push(`#${i + 1} fontes:${d.esperado[i] ?? '—'} dic:${d.atual[i] ?? '—'}`);
  }
  const alerta = dif.length > 3 ? '  <-- muitas divergencias: suspeitar de versao diferente' : '';
  console.log(`${d.reg}  (fontes=${d.esperado.length} campos, dic=${d.atual.length})${alerta}`);
  for (const l of dif) console.log(`    ${l}`);
}
