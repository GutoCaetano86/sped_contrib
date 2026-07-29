// Teste de integridade do dicionario de leiaute (F1-T3).
//
// Falha se qualquer registro tiver numeracao de campo nao sequencial de 1 a
// N, campo 01 diferente de REG, ou campo com tipo diferente de C/N — os tres
// criterios da tarefa. Mais a sanidade de nome, porque os tres sozinhos
// passariam num dicionario com campos chamados "XA", "ANT" e "S", que foi
// exatamente o estado em que o F510 estava.
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarLayout } from '@/lib/sped/layout';
import type { Layout, RegistroIndexado } from '@/lib/sped/types';

let layout: Layout;
let registros: RegistroIndexado[];

beforeAll(() => {
  layout = carregarLayout();
  registros = [...layout.registros.values()];
});

/** Mensagem com o registro e o campo, para a falha apontar o culpado. */
const onde = (reg: RegistroIndexado, num?: number) =>
  num === undefined ? reg.registro : `${reg.registro} campo ${num}`;

describe('integridade do dicionario — criterios de F1-T3', () => {
  it('numeracao dos campos e sequencial de 1 a N', () => {
    const falhas = registros
      .filter((r) => r.campos.some((c, i) => c.num !== i + 1))
      .map((r) => `${onde(r)}: [${r.campos.map((c) => c.num).join(',')}]`);
    expect(falhas).toEqual([]);
  });

  it('campo 01 e sempre REG', () => {
    const falhas = registros
      .filter((r) => r.campos[0]?.nome !== 'REG')
      .map((r) => `${onde(r)}: campo 01 = ${r.campos[0]?.nome}`);
    expect(falhas).toEqual([]);
  });

  it('todo campo tem tipo C ou N', () => {
    const falhas: string[] = [];
    for (const r of registros) {
      for (const c of r.campos) {
        if (c.tipo !== 'C' && c.tipo !== 'N') {
          falhas.push(`${onde(r, c.num)} (${c.nome}): tipo ${JSON.stringify(c.tipo)}`);
        }
      }
    }
    expect(falhas).toEqual([]);
  });
});

describe('integridade do dicionario — sanidade de nome', () => {
  it('nome de campo e unico dentro do registro', () => {
    // Nome repetido quebra o indice O(1) por nome e, na Fase 2, produz duas
    // colunas com o mesmo cabecalho na aba do Excel — e a volta para TXT
    // mapeia coluna POR NOME (spec 5.4).
    const falhas: string[] = [];
    for (const r of registros) {
      const contagem = new Map<string, number[]>();
      for (const c of r.campos) {
        contagem.set(c.nome, [...(contagem.get(c.nome) ?? []), c.num]);
      }
      for (const [nome, nums] of contagem) {
        if (nums.length > 1) falhas.push(`${onde(r)}: "${nome}" nos campos ${nums.join(', ')}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  it('nome de campo tem forma de identificador do leiaute', () => {
    // Pega fragmento orfao ("XA", "ANT") e nome fundido, que os tres
    // criterios da tarefa deixariam passar. Aceita acento, minuscula e
    // hifen: TP_CT-e e CHV_DOCe existem no guia.
    const padrao = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9_-]*$/;
    const falhas: string[] = [];
    for (const r of registros) {
      for (const c of r.campos) {
        if (!padrao.test(c.nome)) falhas.push(`${onde(r, c.num)}: "${c.nome}"`);
        if (c.nome.length < 2) falhas.push(`${onde(r, c.num)}: "${c.nome}" curto demais`);
      }
    }
    expect(falhas).toEqual([]);
  });

  it('o loader nao reporta nenhum defeito de integridade', () => {
    // carregarLayout() acumula os mesmos defeitos enquanto le. Se os testes
    // acima passam e este falha, os dois criterios divergiram.
    expect(layout.avisosIntegridade).toEqual([]);
  });
});

describe('integridade do dicionario — coerencia dos totais', () => {
  it('revisao_manual esta vazia: nao ha pendencia de extracao em aberto', () => {
    expect(layout.pendencias).toEqual([]);
  });

  it('os totais declarados batem com o conteudo', () => {
    expect(layout.total_registros).toBe(layout.registros.size);
    const soma = registros.reduce((s, r) => s + r.campos.length, 0);
    expect(layout.total_campos).toBe(soma);
  });

  it('qtd_campos de cada registro bate com o tamanho do array', () => {
    const falhas = registros
      .filter((r) => r.qtd_campos !== r.campos.length)
      .map((r) => `${onde(r)}: qtd_campos=${r.qtd_campos}, campos=${r.campos.length}`);
    expect(falhas).toEqual([]);
  });

  it('todo registro pertence a um bloco declarado', () => {
    const blocos = new Set(layout.ordem_blocos);
    const falhas = registros.filter((r) => !blocos.has(r.bloco)).map((r) => onde(r));
    expect(falhas).toEqual([]);
  });
});

describe('integridade do dicionario — o que o teste NAO cobre', () => {
  it('registra que 118 dos 192 registros nunca foram exercitados por arquivo real', () => {
    // Os criterios acima sao estruturais: provam que o dicionario e
    // coerente, nao que ele descreve o leiaute certo. Os 74 registros que
    // aparecem nos arquivos aprovados pelo PVA estao conferidos por
    // contagem de campos; os outros 118 sao saida da extracao que ninguem
    // comparou com o guia.
    //
    // Este teste existe para o numero nao passar despercebido. Quando
    // chegarem arquivos reais de outros perfis, ele deve baixar.
    // Ver docs/DICIONARIO-ACHADOS.md.
    const exercitadosPorArquivoReal = 74;
    expect(layout.registros.size - exercitadosPorArquivoReal).toBe(118);
  });
});
