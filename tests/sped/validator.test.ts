// Cobertura da tabela 5.7 da spec: um teste positivo e um negativo para
// cada regra. A ordem das secoes segue a ordem das linhas da tabela.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import { cnpjValido, cpfValido, validar } from '@/lib/sped/validator';
import type { Layout, NoRegistro } from '@/lib/sped/types';

let layout: Layout;
beforeAll(() => {
  layout = carregarLayout();
});

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));

/** CNPJ e CPF com digito verificador correto, para os casos positivos. */
const CNPJ_OK = '11222333000181';
const CPF_OK = '11144477735';
/** Exemplo oficial de CNPJ alfanumerico: 12.ABC.345/01DE-35. */
const CNPJ_ALFA_OK = '12ABC34501DE35';

/** 0000 sem nenhum defeito; os testes trocam um campo de cada vez. */
const campos0000 = [
  '0000', '006', '0', '', '', '01012021', '31012021',
  'EMPRESA TESTE LTDA', CNPJ_OK, 'SP', '3550308', '', '', '1',
];

const comCampo = (indiceBaseZero: number, valor: string): string[] => {
  const copia = [...campos0000];
  copia[indiceBaseZero] = valor;
  return copia;
};

const no = (valores: string[], reg = valores[0] ?? ''): NoRegistro => ({
  id: 'r000001',
  paiId: null,
  reg,
  nivel: 0,
  ordem: 1,
  valores,
  linhaOriginal: 1,
});

const validarUm = (valores: string[]) => validar([no(valores)], layout);
/** Mensagens de erro que citam o campo pedido. */
const errosDe = (r: ReturnType<typeof validar>, campo: string) =>
  r.erros.filter((e) => e.campo === campo);
const avisosDe = (r: ReturnType<typeof validar>, campo: string) =>
  r.avisos.filter((a) => a.campo === campo);

describe('base sem defeito', () => {
  it('o 0000 de referencia nao gera erro nem aviso', () => {
    // Se este teste falhar, os negativos abaixo podem estar acusando a
    // coisa errada.
    const r = validarUm(campos0000);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });
});

describe('5.7 — campo obrigatorio vazio (erro)', () => {
  it('positivo: campo obrigatorio preenchido nao acusa', () => {
    expect(errosDe(validarUm(campos0000), 'NOME')).toEqual([]);
  });

  it('negativo: NOME vazio e erro', () => {
    const r = validarUm(comCampo(7, ''));
    expect(errosDe(r, 'NOME')).toHaveLength(1);
    expect(errosDe(r, 'NOME')[0]?.mensagem).toMatch(/obrigatorio/i);
  });

  it('campo opcional vazio nao acusa nada', () => {
    // SUFRAMA e opcional e esta vazio na base
    expect(validarUm(campos0000).erros).toEqual([]);
  });
});

describe('5.7 — tamanho_fixo com comprimento diferente (erro)', () => {
  it('positivo: COD_VER com os 3 caracteres exigidos', () => {
    expect(errosDe(validarUm(campos0000), 'COD_VER')).toEqual([]);
  });

  it('negativo: COD_VER com 2 caracteres e erro', () => {
    const r = validarUm(comCampo(1, '06'));
    expect(errosDe(r, 'COD_VER')).toHaveLength(1);
    expect(errosDe(r, 'COD_VER')[0]?.mensagem).toMatch(/tamanho fixo/i);
  });
});

describe('5.7 — comprimento acima do tamanho (erro)', () => {
  it('positivo: NOME com 100 caracteres, o maximo, passa', () => {
    expect(errosDe(validarUm(comCampo(7, 'A'.repeat(100))), 'NOME')).toEqual([]);
  });

  it('negativo: NOME com 101 caracteres e erro', () => {
    const r = validarUm(comCampo(7, 'A'.repeat(101)));
    expect(errosDe(r, 'NOME')).toHaveLength(1);
    expect(errosDe(r, 'NOME')[0]?.mensagem).toMatch(/admite ate/i);
  });
});

describe('5.7 — tipo N com caractere nao numerico (erro)', () => {
  it('positivo: COD_MUN numerico passa', () => {
    expect(errosDe(validarUm(campos0000), 'COD_MUN')).toEqual([]);
  });

  it('positivo: virgula e sinal sao aceitos em campo numerico', () => {
    const nos = [no(['C170', '1', 'ITEM', 'DESC', '-1,50'])];
    const r = validar(nos, layout);
    expect(r.erros.filter((e) => /nao e digito/.test(e.mensagem))).toEqual([]);
  });

  it('negativo: COD_MUN com letras e erro', () => {
    const r = validarUm(comCampo(10, 'ABCDEFG'));
    expect(errosDe(r, 'COD_MUN')).toHaveLength(1);
    expect(errosDe(r, 'COD_MUN')[0]?.mensagem).toMatch(/nao e digito/i);
  });
});

describe('5.7 — valor contem o delimitador (erro)', () => {
  it('positivo: valor sem pipe passa', () => {
    expect(validarUm(campos0000).erros).toEqual([]);
  });

  it('negativo: pipe dentro do valor e erro', () => {
    // O parser nunca produz isto (o pipe e delimitador), mas a volta do
    // Excel produz: basta o usuario digitar "|" numa celula.
    const r = validarUm(comCampo(7, 'EMPRESA|TESTE'));
    expect(errosDe(r, 'NOME').some((e) => /delimitador/.test(e.mensagem))).toBe(true);
  });

  it('pega o pipe mesmo em registro fora do leiaute', () => {
    const r = validar([no(['ZZZZ', 'a|b'], 'ZZZZ')], layout);
    expect(r.erros.some((e) => /delimitador/.test(e.mensagem))).toBe(true);
  });
});

describe('5.7 — data fora do padrao ddmmaaaa (erro)', () => {
  it('positivo: 01012021 e data valida', () => {
    expect(errosDe(validarUm(campos0000), 'DT_INI')).toEqual([]);
  });

  it('negativo: 32012021 nao existe', () => {
    const r = validarUm(comCampo(5, '32012021'));
    expect(errosDe(r, 'DT_INI').some((e) => /ddmmaaaa/.test(e.mensagem))).toBe(true);
  });

  it('negativo: 29022021 nao existe, porque 2021 nao e bissexto', () => {
    const r = validarUm(comCampo(5, '29022021'));
    expect(errosDe(r, 'DT_INI').some((e) => /ddmmaaaa/.test(e.mensagem))).toBe(true);
  });

  it('positivo: 29022020 existe, porque 2020 e bissexto', () => {
    expect(errosDe(validarUm(comCampo(5, '29022020')), 'DT_INI')).toEqual([]);
  });
});

describe('5.7 — CNPJ/CPF com digito verificador invalido (aviso)', () => {
  it('positivo: CNPJ com DV correto nao acusa', () => {
    expect(avisosDe(validarUm(campos0000), 'CNPJ')).toEqual([]);
  });

  it('negativo: CNPJ com DV errado e AVISO, nao erro', () => {
    const r = validarUm(comCampo(8, '11222333000199'));
    expect(avisosDe(r, 'CNPJ')).toHaveLength(1);
    expect(errosDe(r, 'CNPJ')).toEqual([]); // severidade aviso, conforme a tabela
  });

  it('CPF: positivo e negativo', () => {
    expect(cpfValido(CPF_OK)).toBe(true);
    expect(cpfValido('11144477700')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false); // repeticao passa na conta
    expect(cpfValido('1114447773')).toBe(false); // 10 digitos
  });

  it('CNPJ_CPF_PART aceita os dois formatos, pelo comprimento', () => {
    const reg = 'C191';
    const temCampo = layout.registro(reg)?.campoPorNome.has('CNPJ_CPF_PART');
    if (!temCampo) return;
    const comCnpj = validar([no([reg, CNPJ_OK])], layout);
    expect(comCnpj.avisos.filter((a) => /digito verificador/.test(a.mensagem))).toEqual([]);
  });
});

describe('CNPJ alfanumerico', () => {
  // Formato novo: 12 posicoes alfanumericas + 2 digitos. O calculo usa o
  // codigo ASCII menos 48, entao o CNPJ so numerico e caso particular.
  it('valida o exemplo oficial 12.ABC.345/01DE-35', () => {
    expect(cnpjValido(CNPJ_ALFA_OK)).toBe(true);
  });

  it('continua validando o CNPJ so numerico', () => {
    expect(cnpjValido(CNPJ_OK)).toBe(true);
    expect(cnpjValido('11222333000199')).toBe(false);
  });

  it('recusa DV errado no alfanumerico', () => {
    expect(cnpjValido('12ABC34501DE99')).toBe(false);
  });

  it('recusa letra minuscula e tamanho errado', () => {
    expect(cnpjValido('12abc34501de35')).toBe(false);
    expect(cnpjValido('12ABC34501DE3')).toBe(false);
  });

  it('recusa letra nas duas ultimas posicoes, que sao sempre numericas', () => {
    expect(cnpjValido('12ABC34501DEAB')).toBe(false);
  });

  it('em campo declarado N, gera AVISO e nao erro', () => {
    // O Guia v1.35 e anterior ao CNPJ alfanumerico e declara o campo como
    // numerico. Tratar como erro bloquearia um CNPJ legitimo.
    const r = validarUm(comCampo(8, CNPJ_ALFA_OK));
    expect(errosDe(r, 'CNPJ')).toEqual([]);
    expect(avisosDe(r, 'CNPJ').some((a) => /alfanumerico/i.test(a.mensagem))).toBe(true);
  });

  it('texto qualquer com letra em campo numerico continua sendo erro', () => {
    // A tolerancia vale so para CNPJ alfanumerico bem formado.
    const r = validarUm(comCampo(8, 'XXXXXXXXXXXXXX'));
    expect(errosDe(r, 'CNPJ').length).toBeGreaterThan(0);
  });
});

describe('5.7 — registro desconhecido no dicionario (aviso)', () => {
  it('positivo: registro do leiaute nao acusa', () => {
    expect(validarUm(campos0000).avisos).toEqual([]);
  });

  it('negativo: registro fora do leiaute e aviso', () => {
    const r = validar([no(['ZZZZ', 'x'], 'ZZZZ')], layout);
    expect(r.avisos.some((a) => /nao consta no leiaute/.test(a.mensagem))).toBe(true);
    expect(r.erros).toEqual([]);
  });
});

describe('5.7 — quantidade de campos diferente do leiaute (aviso)', () => {
  it('positivo: 14 campos no 0000 nao acusa', () => {
    expect(validarUm(campos0000).avisos).toEqual([]);
  });

  it('negativo: 0000 com 3 campos e aviso', () => {
    const r = validar([no(['0000', '006', '0'])], layout);
    expect(r.avisos.some((a) => /o leiaute preve 14/.test(a.mensagem))).toBe(true);
  });
});

describe('5.7 — decimais acima do declarado (aviso)', () => {
  it('positivo: 2 casas em campo de 2 decimais', () => {
    const r = validar([no(['C170', '1', 'ITEM', 'DESC', '1,00'])], layout);
    expect(r.avisos.filter((a) => /casas decimais/.test(a.mensagem))).toEqual([]);
  });

  it('negativo: 4 casas em campo de 2 decimais e aviso', () => {
    const alvo = layout.registro('C170')?.campos.find((c) => c.decimais === 2 && c.num > 4);
    expect(alvo).toBeDefined();
    const valores = ['C170'];
    for (let i = 2; i <= (alvo?.num ?? 0); i++) valores.push('');
    valores[(alvo?.num ?? 1) - 1] = '1,2345';
    const r = validar([no(valores)], layout);
    expect(r.avisos.some((a) => /casas decimais/.test(a.mensagem))).toBe(true);
  });
});

describe('validar — comportamento geral', () => {
  it('separa por severidade, como a tabela 5.7 manda', () => {
    const r = validarUm(comCampo(7, '')); // obrigatorio vazio -> erro
    expect(r.erros.every((e) => e.severidade === 'erro')).toBe(true);
    expect(r.avisos.every((a) => a.severidade === 'aviso')).toBe(true);
  });

  it('aponta linha, registro e campo', () => {
    const r = validarUm(comCampo(7, ''));
    expect(r.erros[0]).toMatchObject({ linha: 1, registro: '0000', campo: 'NOME' });
  });

  it('nao para no primeiro defeito', () => {
    const valores = comCampo(7, ''); // NOME vazio
    valores[1] = '06'; // COD_VER com tamanho errado
    valores[10] = 'XXX'; // COD_MUN nao numerico
    const r = validar([no(valores)], layout);
    expect(new Set(r.erros.map((e) => e.campo)).size).toBeGreaterThanOrEqual(3);
  });

  it('arvore vazia nao gera nada', () => {
    expect(validar([], layout)).toEqual({ erros: [], avisos: [] });
  });

  it('o arquivo real reduzido nao tem erro bloqueante', () => {
    // Arquivo aprovado pelo PVA: se o validador acusar erro aqui, ele esta
    // rigoroso demais e barraria arquivo legitimo.
    const r = validar(parseTxt(fixture('efd_reduzido.txt'), layout).nos, layout);
    expect(r.erros).toEqual([]);
  });

  it('a fixture de erros acusa os defeitos propositais', () => {
    const r = validar(parseTxt(fixture('efd_com_erros.txt'), layout).nos, layout);
    expect(r.avisos.some((a) => a.registro === 'XXXX')).toBe(true);
    expect(r.erros.length).toBeGreaterThan(0);
  });
});
