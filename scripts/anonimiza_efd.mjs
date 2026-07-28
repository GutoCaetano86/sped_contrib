// Anonimiza um arquivo real da EFD-Contribuicoes para virar fixture de teste.
//
// Objetivo: preservar a ESTRUTURA byte a byte (mesmas linhas, mesma sequencia
// de registros, mesmos comprimentos de campo, totalizadores intactos) e
// trocar so o conteudo identificavel.
//
// Principios:
//
//  - Mapeamento CONSISTENTE: o mesmo valor de entrada sempre vira o mesmo
//    valor de saida. Sem isso as referencias entre registros quebram (o
//    participante do 0150 citado no C100, o item do 0200 citado no C170).
//  - Mesmo COMPRIMENTO sempre. Campo de tamanho fixo nao pode mudar, e
//    manter o comprimento preserva o tamanho do arquivo.
//  - Bloco 9 e registros X990 NAO sao tocados: seus campos sao contagens.
//    Como nenhuma linha e adicionada ou removida, os totalizadores
//    continuam corretos.
//  - Data e codigo curto (UF, CST, CFOP) ficam como estao: nao identificam
//    ninguem e a realidade estrutural do arquivo depende deles.
//
// AVISO: o resultado NAO e mais um arquivo aprovado pelo PVA. Ele e
// estruturalmente identico a um. Serve para round-trip, parser e
// serializer; nao serve para conferir regra de negocio fiscal.
//
// Uso:
//   node scripts/anonimiza_efd.mjs entrada.txt saida.txt
import { readFileSync, writeFileSync } from 'node:fs';

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error('uso: node scripts/anonimiza_efd.mjs <entrada.txt> <saida.txt>');
  process.exit(1);
}

// PRNG deterministico: rodar duas vezes na mesma entrada da a mesma saida.
let semente = 20211231;
function proximo() {
  semente = (semente * 1103515245 + 12345) & 0x7fffffff;
  return semente / 0x7fffffff;
}
const digito = () => Math.floor(proximo() * 10);

const CONSOANTES = 'BCDFGHJKLMNPRSTVZ';
const VOGAIS = 'AEIOU';

function palavra(tamanho) {
  let s = '';
  while (s.length < tamanho) {
    s += CONSOANTES[Math.floor(proximo() * CONSOANTES.length)];
    if (s.length < tamanho) s += VOGAIS[Math.floor(proximo() * VOGAIS.length)];
  }
  return s.slice(0, tamanho);
}

/** Texto sintetico do mesmo comprimento, com espacos nas mesmas posicoes. */
function textoFalso(original) {
  const pedacos = original.split(' ');
  return pedacos.map((p) => (p ? palavra(p.length) : '')).join(' ');
}

function digitosVerificadoresCnpj(base12) {
  const calc = (nums, pesos) => {
    const soma = nums.reduce((s, n, i) => s + n * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const n = base12.split('').map(Number);
  const d1 = calc(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc([...n, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${d1}${d2}`;
}

function digitosVerificadoresCpf(base9) {
  const n = base9.split('').map(Number);
  const calc = (nums, pesoInicial) => {
    const soma = nums.reduce((s, x, i) => s + x * (pesoInicial - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(n, 10);
  const d2 = calc([...n, d1], 11);
  return `${d1}${d2}`;
}

const cache = new Map();
function consistente(chave, gerar) {
  if (!cache.has(chave)) cache.set(chave, gerar());
  return cache.get(chave);
}

const RE_DATA = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}$/;
const RE_MONETARIO = /^-?\d+,\d+$/;

function anonimizaValor(v) {
  if (!v) return v;
  if (RE_DATA.test(v)) return v; // data nao identifica

  // CNPJ: 14 digitos
  if (/^\d{14}$/.test(v)) {
    return consistente('cnpj:' + v, () => {
      const base = Array.from({ length: 12 }, digito).join('');
      return base + digitosVerificadoresCnpj(base);
    });
  }
  // CPF: 11 digitos
  if (/^\d{11}$/.test(v)) {
    return consistente('cpf:' + v, () => {
      const base = Array.from({ length: 9 }, digito).join('');
      return base + digitosVerificadoresCpf(base);
    });
  }
  // valor monetario: embaralha mantendo formato
  if (RE_MONETARIO.test(v)) {
    return consistente('num:' + v, () =>
      v.replace(/\d/g, () => String(digito())).replace(/^0+(?=\d)/, (m) => '1'.repeat(m.length)),
    );
  }
  // texto: so vale a pena mascarar o que tem letra e algum tamanho
  if (/[A-Za-zÀ-ÿ]/.test(v) && v.length > 3) {
    return consistente('txt:' + v, () => textoFalso(v));
  }
  return v; // codigo curto, UF, CST, CFOP, numero de documento
}

const linhas = readFileSync(entrada).toString('latin1').split('\r\n');
const ultimaVazia = linhas[linhas.length - 1] === '';
const corpo = ultimaVazia ? linhas.slice(0, -1) : linhas;

let tocadas = 0;
const saidaLinhas = corpo.map((linha) => {
  if (!linha.startsWith('|') || !linha.endsWith('|')) return linha;
  const valores = linha.slice(1, -1).split('|');
  const reg = valores[0];
  // bloco 9 e encerramentos de bloco carregam contagens: nao mexer
  if (reg.startsWith('9') || /^\w990$/.test(reg)) return linha;

  let mudou = false;
  const novos = valores.map((v, i) => {
    if (i === 0) return v; // REG
    const novo = anonimizaValor(v);
    if (novo !== v) mudou = true;
    return novo;
  });
  if (mudou) tocadas++;
  return '|' + novos.join('|') + '|';
});

const texto = saidaLinhas.join('\r\n') + '\r\n';
writeFileSync(saida, Buffer.from(texto, 'latin1'));

console.log(`linhas: ${corpo.length} -> ${saidaLinhas.length}`);
console.log(`linhas com algum campo trocado: ${tocadas}`);
console.log(`valores distintos mascarados: ${cache.size}`);
console.log(`bytes: ${readFileSync(entrada).length} -> ${readFileSync(saida).length}`);
