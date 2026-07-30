#!/usr/bin/env tsx
// CLI interna de conversao (F2-T4).
//
//   npm run convert -- entrada.txt  --saida saida.xlsx
//   npm run convert -- entrada.xlsx --saida saida.txt
//
// A direcao vem da extensao da ENTRADA. Serve para rodar o pipeline sem
// subir a aplicacao, que e o criterio de saida da Fase 1 (spec 10).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { lerExcel } from '../lib/sped/from-excel';
import { carregarLayout } from '../lib/sped/layout';
import { parseTxt } from '../lib/sped/parser';
import { serializarTxt } from '../lib/sped/serializer';
import { gerarExcel } from '../lib/sped/to-excel';
import { recalcularTotalizadores } from '../lib/sped/totalizers';
import { validar } from '../lib/sped/validator';
import type { ErroValidacao, NoRegistro } from '../lib/sped/types';

const USO = `
Uso:
  npm run convert -- <entrada.txt|entrada.xlsx> [--saida <arquivo>] [opcoes]

Opcoes:
  --saida <arquivo>    caminho de saida; por padrao troca a extensao da entrada
  --descricoes         inclui a linha de descricao dos campos no Excel
  --sem-validar        pula a validacao (mais rapido em arquivo grande)
  --quieto             so o resumo, sem a lista de ocorrencias
`.trim();

interface Opcoes {
  entrada: string;
  saida: string;
  descricoes: boolean;
  validar: boolean;
  quieto: boolean;
}

function lerArgumentos(argv: string[]): Opcoes | null {
  const livres: string[] = [];
  let saida = '';
  let descricoes = false;
  let validarFlag = true;
  let quieto = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--saida' || arg === '-o') {
      saida = argv[++i] ?? '';
    } else if (arg === '--descricoes') {
      descricoes = true;
    } else if (arg === '--sem-validar') {
      validarFlag = false;
    } else if (arg === '--quieto' || arg === '-q') {
      quieto = true;
    } else if (arg === '--ajuda' || arg === '-h') {
      return null;
    } else if (arg.startsWith('-')) {
      console.error(`Opção desconhecida: ${arg}`);
      return null;
    } else {
      livres.push(arg);
    }
  }

  const entrada = livres[0];
  if (!entrada || livres.length > 1) return null;

  const ext = extname(entrada).toLowerCase();
  if (ext !== '.txt' && ext !== '.xlsx') {
    console.error(`Extensão "${ext || '(nenhuma)'}" não suportada; use .txt ou .xlsx.`);
    return null;
  }

  return {
    entrada,
    saida: saida || entrada.replace(/\.(txt|xlsx)$/i, ext === '.txt' ? '.xlsx' : '.txt'),
    descricoes,
    validar: validarFlag,
    quieto,
  };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const seg = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Resumo por tipo de registro, util para conferencia (spec 7.4). */
function resumoPorRegistro(nos: NoRegistro[]): string[] {
  const contagem = new Map<string, number>();
  for (const no of nos) contagem.set(no.reg, (contagem.get(no.reg) ?? 0) + 1);
  return [...contagem.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reg, n]) => `${reg}:${n}`);
}

/** Ocorrencias agrupadas, para nao despejar 4.000 linhas iguais no terminal. */
function mostrarOcorrencias(rotulo: string, itens: ErroValidacao[], quieto: boolean): void {
  if (itens.length === 0) return;
  console.log(`\n${rotulo}: ${itens.length}`);
  if (quieto) return;

  const grupos = new Map<string, { n: number; exemplo: ErroValidacao }>();
  for (const item of itens) {
    const chave = `${item.registro ?? '-'}|${item.campo ?? '-'}|${item.mensagem}`;
    const atual = grupos.get(chave);
    if (atual) atual.n++;
    else grupos.set(chave, { n: 1, exemplo: item });
  }

  const ordenados = [...grupos.values()].sort((a, b) => b.n - a.n);
  for (const { n, exemplo } of ordenados.slice(0, 15)) {
    const onde = [exemplo.registro, exemplo.campo].filter(Boolean).join('.');
    const linha = exemplo.linha ? ` (1a na linha ${exemplo.linha})` : '';
    console.log(`  ${String(n).padStart(6)}x ${onde ? `${onde}: ` : ''}${exemplo.mensagem}${linha}`);
  }
  if (ordenados.length > 15) {
    console.log(`  ... e mais ${ordenados.length - 15} tipo(s) de ocorrência`);
  }
}

async function main(): Promise<void> {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (!opcoes) {
    console.log(USO);
    process.exitCode = 1;
    return;
  }

  const inicio = Date.now();
  const layout = carregarLayout();
  const bytes = readFileSync(opcoes.entrada);
  const paraExcel = extname(opcoes.entrada).toLowerCase() === '.txt';

  console.log(`${basename(opcoes.entrada)} (${mb(bytes.length)}) -> ${basename(opcoes.saida)}`);
  console.log(`direção: ${paraExcel ? 'TXT → XLSX' : 'XLSX → TXT'}`);

  const resultado = paraExcel ? parseTxt(bytes, layout) : await lerExcel(bytes, layout);

  // Erro NAO bloqueia TXT -> XLSX: o usuario quer ver e corrigir na planilha.
  // Erro BLOQUEIA XLSX -> TXT: gerar arquivo que o PVA recusa e pior que nao
  // gerar (spec 11, decisoes 6 e 7).
  const validacao = opcoes.validar
    ? validar(resultado.nos, layout)
    : { erros: [], avisos: [] };
  const erros = [...resultado.erros, ...validacao.erros];
  const avisos = [...resultado.avisos, ...validacao.avisos];

  console.log(`\nlinhas: ${resultado.nos.length.toLocaleString('pt-BR')}`);
  console.log(`tipos de registro: ${new Set(resultado.nos.map((n) => n.reg)).size}`);
  if (resultado.cabecalho.cnpj) {
    console.log(
      `CNPJ ${resultado.cabecalho.cnpj} · ${resultado.cabecalho.razaoSocial} · ` +
        `${resultado.cabecalho.dtIni}–${resultado.cabecalho.dtFin}`,
    );
  }
  if (!opcoes.quieto) {
    console.log(`\nregistros: ${resumoPorRegistro(resultado.nos).join(' ')}`);
  }

  mostrarOcorrencias('ERROS', erros, opcoes.quieto);
  mostrarOcorrencias('avisos', avisos, opcoes.quieto);

  if (!paraExcel && erros.length > 0) {
    console.error(
      `\nAbortado: ${erros.length} erro(s) bloqueiam a geração do TXT. ` +
        `Corrija na planilha e rode de novo.`,
    );
    process.exitCode = 1;
    return;
  }

  const saida = paraExcel
    ? await gerarExcel(resultado, layout, {
        incluirDescricoes: opcoes.descricoes,
        arquivoOrigem: basename(opcoes.entrada),
        hashOrigem: createHash('sha256').update(bytes).digest('hex'),
      })
    : serializarTxt(recalcularTotalizadores(resultado.nos), avisos);

  writeFileSync(opcoes.saida, saida);
  console.log(
    `\ngravado: ${basename(opcoes.saida)} (${mb(saida.length)}) em ${seg(Date.now() - inicio)}`,
  );
}

main().catch((causa) => {
  console.error(`\nFalhou: ${causa instanceof Error ? causa.message : String(causa)}`);
  process.exitCode = 1;
});
