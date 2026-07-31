// Base de calculo do credito. Ver lib/sped/apuracao.ts.
//
// O caso que motivou o modulo: apagar 5 itens de C170 na planilha fez o PVA
// recusar o arquivo em 30/07/2026, cobrando exatamente os R$ 6.682,59 que os
// itens somavam em VL_BC_PIS.
import { beforeAll, describe, expect, it } from 'vitest';
import { aprenderAtribuicao, recalcularBasesDeCredito } from '@/lib/sped/apuracao';
import { carregarLayout } from '@/lib/sped/layout';
import { paraDecimal } from '@/lib/sped/numeros';
import { parseTxt } from '@/lib/sped/parser';
import type { Layout, NoRegistro } from '@/lib/sped/types';

let layout: Layout;
beforeAll(() => {
  layout = carregarLayout();
});

/** Monta a linha do registro a partir de campos esparsos, com o tamanho certo. */
function linha(reg: string, campos: Record<number, string>): string {
  const doLayout = layout.registro(reg);
  const total = doLayout?.qtd_campos ?? Math.max(...Object.keys(campos).map(Number), 1);
  const valores = Array.from({ length: total }, (_, i) => campos[i + 1] ?? '');
  valores[0] = reg;
  return `|${valores.join('|')}|`;
}

/** Item de nota do bloco C: o CFOP e a unica pista da natureza do credito. */
const c170 = (num: string, cfop: string, base: string) =>
  linha('C170', {
    2: num, 3: `IT${num}`, 4: 'ITEM', 11: cfop,
    25: '56', 26: base, 27: '1,65',
    31: '56', 32: base, 33: '7,6',
  });

/** Item do bloco A: aqui a natureza vem declarada no proprio registro. */
const a170 = (num: string, nat: string, base: string) =>
  linha('A170', {
    2: num, 3: `IA${num}`, 4: 'SERVICO', 7: nat,
    9: '56', 10: base, 11: '1,65',
    13: '56', 14: base, 15: '7,6',
  });

const m105 = (nat: string, total: string) =>
  linha('M105', { 2: nat, 3: '56', 4: total, 5: '0,00', 6: total, 7: total });
const m505 = (nat: string, total: string) =>
  linha('M505', { 2: nat, 3: '56', 4: total, 5: '0,00', 6: total, 7: total });

/**
 * Arquivo minimo que FECHA: as fontes somam exatamente os baldes.
 *
 * CFOP 1102 (revenda) -> NAT 01 = 2000,00
 * CFOP 1101 (insumo)  -> NAT 02 =  500,00
 * A170 declara        -> NAT 03 = 1000,00
 */
function arquivoQueFecha(): NoRegistro[] {
  const linhas = [
    linha('0000', { 2: '006', 3: '0', 6: '01122021', 7: '31122021', 8: 'EMPRESA', 9: '11111111000191' }),
    linha('A001', { 2: '0' }),
    linha('A010', { 2: '11111111000191' }),
    linha('A100', { 2: '0', 3: '1' }),
    a170('1', '03', '1000,00'),
    linha('C001', { 2: '0' }),
    linha('C010', { 2: '11111111000191', 3: '2' }),
    linha('C100', { 2: '0', 3: '1', 5: '55', 6: '00', 8: '100' }),
    c170('1', '1102', '2000,00'),
    c170('2', '1101', '500,00'),
    linha('M001', { 2: '0' }),
    // VL_CRED = VL_BC x aliquota; DISP = VL_CRED; IND_DESC_CRED 0 = desconto
    // total, entao DESC = DISP e SLD = 0. Sao as identidades que o PVA valida.
    linha('M100', {
      2: '101', 3: '0', 4: '3500,00', 5: '1,65', 8: '57,75',
      12: '57,75', 13: '0', 14: '57,75', 15: '0,00',
    }),
    m105('01', '2000,00'),
    m105('02', '500,00'),
    m105('03', '1000,00'),
    linha('M200', { 2: '100,00', 3: '57,75', 4: '0,00', 5: '42,25', 6: '0,00',
                    7: '0,00', 8: '42,25', 12: '0,00', 13: '42,25' }),
    linha('M500', {
      2: '101', 3: '0', 4: '3500,00', 5: '7,6', 8: '266,00',
      12: '266,00', 13: '0', 14: '266,00', 15: '0,00',
    }),
    m505('01', '2000,00'),
    m505('02', '500,00'),
    m505('03', '1000,00'),
    linha('M600', { 2: '500,00', 3: '266,00', 4: '0,00', 5: '234,00', 6: '0,00',
                    7: '0,00', 8: '234,00', 12: '0,00', 13: '234,00' }),
  ];
  return parseTxt(Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1'), layout).nos;
}

const baseDoBalde = (nos: NoRegistro[], reg: string, nat: string): string =>
  nos.find((n) => n.reg === reg && n.valores[1] === nat)?.valores[3] ?? '(ausente)';

const semItem = (nos: NoRegistro[], reg: string, num: string): NoRegistro[] =>
  nos.filter((n) => !(n.reg === reg && n.valores[1] === num));

describe('aprenderAtribuicao', () => {
  it('deduz a natureza do crédito de cada CFOP quando a soma fecha', () => {
    const { mapa, avisos } = aprenderAtribuicao(arquivoQueFecha());

    expect(avisos).toEqual([]);
    expect(mapa.fechou).toEqual(['pis', 'cofins']);
    // 1102 é compra para revenda; 1101, para industrialização.
    expect(mapa.pis['1,65|1102']).toBe('01');
    expect(mapa.pis['1,65|1101']).toBe('02');
    expect(mapa.cofins['7,6|1102']).toBe('01');
    expect(mapa.cofins['7,6|1101']).toBe('02');
  });

  /** Faz um balde declarar mais do que os documentos somam. */
  const desequilibra = (nos: NoRegistro[], reg: string) =>
    nos.map((n) =>
      n.reg === reg && n.valores[1] === '01'
        ? { ...n, valores: n.valores.map((v, i) => (i === 3 ? '9999,00' : v)) }
        : n,
    );

  it('não inventa mapa quando a base não fecha com os documentos', () => {
    // Um M105 declarando mais do que os documentos somam: pode ser fonte de
    // crédito que este módulo ainda não conhece. Adivinhar aqui produziria
    // arquivo aceito pelo PVA e errado no crédito.
    const nos = desequilibra(desequilibra(arquivoQueFecha(), 'M105'), 'M505');
    const { mapa, avisos } = aprenderAtribuicao(nos);

    expect(mapa.fechou).toEqual([]);
    expect(avisos.some((a) => /não fecha com os documentos/.test(a.mensagem))).toBe(true);
  });

  it('um tributo que não fecha não derruba o outro', () => {
    // Mapa parcial é seguro: o tributo sem entradas bloqueia por si só, porque
    // seus CFOP ficam sem atribuição conhecida.
    const { mapa, avisos } = aprenderAtribuicao(desequilibra(arquivoQueFecha(), 'M105'));

    expect(mapa.fechou).toEqual(['cofins']);
    expect(mapa.pis).toEqual({});
    expect(mapa.cofins['7,6|1102']).toBe('01');
    expect(avisos.some((a) => /PIS não fecha/.test(a.mensagem))).toBe(true);
  });

  it('arquivo sem bloco M não produz mapa nem reclama', () => {
    const nos = arquivoQueFecha().filter((n) => !n.reg.startsWith('M'));
    const { mapa, avisos } = aprenderAtribuicao(nos);
    expect(mapa.fechou).toEqual([]);
    expect(avisos).toEqual([]);
  });
});

describe('recalcularBasesDeCredito', () => {
  it('sem edição não mexe em nada — é o que segura o round-trip byte a byte', () => {
    const nos = arquivoQueFecha();
    const { mapa } = aprenderAtribuicao(nos);
    const antes = nos.map((n) => n.valores.join('|'));

    const r = recalcularBasesDeCredito(nos, mapa);

    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.nos.map((n) => n.valores.join('|'))).toEqual(antes);
  });

  it('apagar item de C170 abate a base do NAT que aquele CFOP alimenta', () => {
    const original = arquivoQueFecha();
    const { mapa } = aprenderAtribuicao(original);

    // O item de CFOP 1101 vale 500,00 e alimenta o NAT 02.
    const editado = semItem(original, 'C170', '2');
    const r = recalcularBasesDeCredito(editado, mapa);

    expect(r.erros).toEqual([]);
    expect(baseDoBalde(r.nos, 'M105', '02')).toBe('0,00');
    expect(baseDoBalde(r.nos, 'M505', '02')).toBe('0,00');
    // Os outros baldes não podem ser tocados.
    expect(baseDoBalde(r.nos, 'M105', '01')).toBe('2000,00');
    expect(baseDoBalde(r.nos, 'M105', '03')).toBe('1000,00');
    expect(r.avisos.some((a) => /-500,00/.test(a.mensagem))).toBe(true);
  });

  it('tolera o centavo de arredondamento do rateio, sem "consertar" o arquivo', () => {
    // O arquivo real aprovado tem 4 grupos por tributo em que a soma do campo 7
    // difere do campo 6 por exatamente 0,01 — cada parcela é arredondada em
    // separado e o PVA aceita. Sem esta folga o recálculo reescreveria esses
    // centavos e o round-trip byte a byte morreria em arquivo não editado.
    const nos = arquivoQueFecha().map((n) =>
      n.reg === 'M105' && n.valores[1] === '01'
        ? { ...n, valores: n.valores.map((v, i) => (i === 6 ? '2000,01' : v)) }
        : n,
    );
    const antes = nos.map((n) => n.valores.join('|'));

    const r = recalcularBasesDeCredito(nos, aprenderAtribuicao(arquivoQueFecha()).mapa);

    expect(r.erros).toEqual([]);
    expect(r.nos.map((n) => n.valores.join('|'))).toEqual(antes);
  });

  it('mantém VL_BC_NC = VL_BC_TOT − VL_BC_CUM, que o PVA valida à parte', () => {
    // Escapou na primeira versão: corrigi só o campo 4 e o PVA recusou de novo,
    // agora apontando o campo 6. São duas regras, não uma.
    const editado = semItem(arquivoQueFecha(), 'C170', '2');
    const r = recalcularBasesDeCredito(editado, aprenderAtribuicao(arquivoQueFecha()).mapa);

    for (const reg of ['M105', 'M505']) {
      const no = r.nos.find((n) => n.reg === reg && n.valores[1] === '02')!;
      expect(paraDecimal(no.valores[5])).toBe(
        paraDecimal(no.valores[3]) - paraDecimal(no.valores[4]),
      );
    }
  });

  it('avisa quando joga a diferença inteira na parcela não cumulativa', () => {
    const comCumulativa = arquivoQueFecha().map((n) =>
      (n.reg === 'M105' || n.reg === 'M505') && n.valores[1] === '02'
        ? { ...n, valores: n.valores.map((v, i) => (i === 4 ? '100,00' : v)) }
        : n,
    );
    const { mapa } = aprenderAtribuicao(arquivoQueFecha());
    const r = recalcularBasesDeCredito(semItem(comCumulativa, 'C170', '2'), mapa);

    expect(r.avisos.some((a) => /parcela não cumulativa/.test(a.mensagem))).toBe(true);
    const no = r.nos.find((n) => n.reg === 'M105' && n.valores[1] === '02')!;
    // TOT vira 0,00 e CUM continua 100,00, entao NC fica -100,00.
    expect(no.valores[5]).toBe('-100,00');
  });

  it('apagar item de A170 usa o NAT_BC_CRED declarado, sem depender do mapa', () => {
    const editado = semItem(arquivoQueFecha(), 'A170', '1');
    const r = recalcularBasesDeCredito(editado, aprenderAtribuicao(arquivoQueFecha()).mapa);

    expect(r.erros).toEqual([]);
    expect(baseDoBalde(r.nos, 'M105', '03')).toBe('0,00');
  });

  it('propaga a cascata até o crédito e avisa que o valor devido mudou', () => {
    // O PVA valida a cadeia inteira: soma do campo 7 = campo 6, VL_BC do M100
    // = soma dos campos 7, VL_CRED = VL_BC x alíquota. Parar no campo 4 fez
    // ele recusar o arquivo três vezes.
    const editado = semItem(arquivoQueFecha(), 'C170', '2');
    const r = recalcularBasesDeCredito(editado, aprenderAtribuicao(arquivoQueFecha()).mapa);

    const m105 = r.nos.filter((n) => n.reg === 'M105');
    const m100 = r.nos.find((n) => n.reg === 'M100')!;

    // campo 7 acompanhou o campo 6 em cada balde
    for (const no of m105) {
      expect(paraDecimal(no.valores[6])).toBe(paraDecimal(no.valores[5]));
    }
    // M100.VL_BC = soma dos campos 7; VL_CRED = VL_BC x 1,65%
    const soma = m105.reduce((a, n) => a + paraDecimal(n.valores[6]), 0n);
    expect(paraDecimal(m100.valores[3])).toBe(soma);
    expect(m100.valores[3]).toBe('3000,00');
    expect(m100.valores[7]).toBe('49,50');

    // A consolidacao do periodo acompanha: menos credito, mais imposto.
    const m200 = r.nos.find((n) => n.reg === 'M200')!;
    expect(m200.valores[2]).toBe('49,50');   // credito descontado
    expect(m200.valores[4]).toBe('50,50');   // contribuicao devida: 100,00 - 49,50
    expect(m200.valores[7]).toBe('50,50');   // a recolher
    expect(r.avisos.some((a) => /altera o valor devido/.test(a.mensagem))).toBe(true);
  });

  it('BLOQUEIA quando a base mudou e não há mapa', () => {
    // Planilha gerada antes desta funcionalidade. Gerar o TXT assim produz o
    // arquivo que o PVA recusou (spec 11, decisão 7).
    const editado = semItem(arquivoQueFecha(), 'C170', '2');
    const r = recalcularBasesDeCredito(editado, null);

    expect(r.erros.length).toBeGreaterThan(0);
    expect(r.erros[0]?.mensagem).toMatch(/Gere o Excel de novo/);
    // E não pode ter alterado valor nenhum.
    expect(baseDoBalde(r.nos, 'M105', '02')).toBe('500,00');
  });

  it('sem mapa, arquivo NÃO editado continua passando', () => {
    const r = recalcularBasesDeCredito(arquivoQueFecha(), null);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it('BLOQUEIA quando o mesmo NAT é declarado com valores diferentes em M100 distintos', () => {
    // Acontece no arquivo real (NAT 09): o par (alíquota, natureza) alimenta
    // duas famílias de COD_CRED e não há como saber qual absorve a diferença.
    const nos = arquivoQueFecha();
    const { mapa } = aprenderAtribuicao(nos);

    const extra = parseTxt(
      Buffer.from(
        [
          linha('M100', { 2: '108', 3: '0', 4: '300,00', 5: '1,65', 8: '4,95' }),
          m105('02', '300,00'),
        ].join('\r\n') + '\r\n',
        'latin1',
      ),
      layout,
    ).nos.map((n, i) => ({ ...n, id: `extra${i}`, ordem: 1000 + i }));

    const editado = semItem([...nos, ...extra], 'C170', '2');
    const r = recalcularBasesDeCredito(editado, mapa);

    expect(r.erros.some((e) => /mais de um M100/.test(e.mensagem))).toBe(true);
  });
});
