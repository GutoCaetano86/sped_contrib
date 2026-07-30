// Base de calculo do credito: aprende a atribuicao no arquivo original e a
// reaplica quando o usuario edita a planilha.
//
// POR QUE ISTO EXISTE
// Apagar um item de C170 na planilha invalida o arquivo: o PVA recalcula
// M105.VL_BC_PIS_TOT (e M505.VL_BC_COFINS_TOT) somando os documentos e recusa
// quando o total declarado nao bate. Foi o que aconteceu em 30/07/2026 — 5
// itens de C170 removidos, e o PVA cobrou exatamente os R$ 6.682,59 de
// diferenca.
//
// O PROBLEMA
// O C170 NAO tem campo NAT_BC_CRED: a natureza do credito de um item do bloco
// C vem da classificacao fiscal (revenda, insumo, ativo), que o CFOP sugere
// mas nao determina. Inventar uma tabela CFOP -> NAT_BC_CRED geral seria
// assumir premissa fiscal de um contribuinte para todos, e o erro sairia
// aceito pelo PVA e errado no credito.
//
// A SOLUCAO
// Aprender a atribuicao do proprio arquivo. O TXT de origem foi aceito pelo
// PVA, entao seus M105 sao verdade: da para descobrir qual grupo de CFOP
// alimenta cada NAT resolvendo o sistema, e so aceitar o resultado quando ele
// fecha EXATO. No arquivo real de 138.100 linhas fecha com diferenca 0,00 nos
// dois tributos, e o mapa que sai e fiscalmente coerente (1102/2102 -> 01
// revenda, 1101/2101 -> 02 insumo, 1124/1125 -> 03 industrializacao...).
//
// LIMITE CONHECIDO, E POR QUE E ACEITAVEL
// A solucao encontrada e a primeira que fecha; nao provamos unicidade, que e
// exponencial. Se dois grupos de CFOP fossem trocaveis, o delta cairia no NAT
// errado — e o PVA acusaria os DOIS baldes, porque valida exatamente esta
// relacao. O erro aparece na validacao, nao passa silencioso.
import type { ErroValidacao, MapaAtribuicao, NoRegistro } from './types';
import { casasDecimais, formatarDecimal, paraDecimal } from './numeros';

export type { MapaAtribuicao };

export type Tributo = 'pis' | 'cofins';

/** Posicao dos campos que interessam, em numero de campo do leiaute (1-based). */
interface FonteBase {
  /** NAT_BC_CRED, quando o registro o declara. `null` = precisa ser inferido. */
  nat: number | null;
  cst: number;
  base: number;
  aliquota: number;
  /** CFOP, a pista para inferir o NAT. */
  cfop: number | null;
}

/**
 * Registros que alimentam a base de credito.
 *
 * Conferida contra o arquivo real: com exatamente estes registros a soma bate
 * com os M105 na casa do centavo. Se um perfil diferente usar outro registro
 * de credito, a soma nao fecha e o aprendizado e recusado — que e o
 * comportamento certo, e o sinal de que esta tabela precisa crescer.
 */
const FONTES: Record<Tributo, Record<string, FonteBase>> = {
  pis: {
    A170: { nat: 7, cst: 9, base: 10, aliquota: 11, cfop: null },
    C170: { nat: null, cst: 25, base: 26, aliquota: 27, cfop: 11 },
    C501: { nat: 4, cst: 2, base: 5, aliquota: 6, cfop: null },
    C601: { nat: null, cst: 2, base: 4, aliquota: 5, cfop: null },
    D101: { nat: 5, cst: 4, base: 6, aliquota: 7, cfop: null },
    F100: { nat: 15, cst: 7, base: 8, aliquota: 9, cfop: null },
    F120: { nat: 2, cst: 8, base: 9, aliquota: 10, cfop: null },
    F130: { nat: 2, cst: 11, base: 12, aliquota: 13, cfop: null },
  },
  cofins: {
    A170: { nat: 7, cst: 13, base: 14, aliquota: 15, cfop: null },
    C170: { nat: null, cst: 31, base: 32, aliquota: 33, cfop: 11 },
    C505: { nat: 4, cst: 2, base: 5, aliquota: 6, cfop: null },
    C605: { nat: null, cst: 2, base: 4, aliquota: 5, cfop: null },
    D105: { nat: 5, cst: 4, base: 6, aliquota: 7, cfop: null },
    F100: { nat: 15, cst: 11, base: 12, aliquota: 13, cfop: null },
    F120: { nat: 2, cst: 12, base: 13, aliquota: 14, cfop: null },
    F130: { nat: 2, cst: 15, base: 16, aliquota: 17, cfop: null },
  },
};

/** Onde ficam os baldes de cada tributo. */
const APURACAO: Record<Tributo, { pai: string; filho: string; aliquotaDoPai: number }> = {
  pis: { pai: 'M100', filho: 'M105', aliquotaDoPai: 5 },
  cofins: { pai: 'M500', filho: 'M505', aliquotaDoPai: 5 },
};

/** CST que geram credito: 50 a 56 e 60 a 66 (tabela 4.3.7 do guia). */
const CST_CREDITO = new Set(
  [...Array.from({ length: 7 }, (_, i) => 50 + i), ...Array.from({ length: 7 }, (_, i) => 60 + i)].map(
    (n) => String(n).padStart(2, '0'),
  ),
);

/** Chave do balde e do grupo. Alíquota entra porque separa os M100. */
const chave = (aliquota: string, discriminante: string): string =>
  `${aliquota.trim()}|${discriminante.trim()}`;

const campo = (no: NoRegistro, num: number | null): string =>
  num === null ? '' : (no.valores[num - 1] ?? '');

interface Levantamento {
  /** `"aliquota|nat"` -> soma das fontes que declaram o NAT. */
  declarado: Map<string, bigint>;
  /** `"aliquota|cfop"` -> soma das fontes sem NAT. */
  grupos: Map<string, bigint>;
  /** `"aliquota|nat"` -> total declarado nos M105 daquele balde. */
  baldes: Map<string, bigint>;
  /** Baldes cujo `"aliquota|nat"` aparece com valores diferentes em M100
   *  distintos: o mesmo par alimenta familias de COD_CRED separadas e nao da
   *  para saber qual delas absorve uma mudanca. */
  baldesDivididos: Set<string>;
  /** Nos M105/M505 de cada balde, para reescrever depois. */
  nosDoBalde: Map<string, NoRegistro[]>;
}

const acumula = (mapa: Map<string, bigint>, k: string, v: bigint): void => {
  mapa.set(k, (mapa.get(k) ?? 0n) + v);
};

/** Percorre a AST uma vez e levanta fontes e baldes de um tributo. */
function levantar(nos: NoRegistro[], tributo: Tributo): Levantamento {
  const fontes = FONTES[tributo];
  const { pai, filho, aliquotaDoPai } = APURACAO[tributo];

  const declarado = new Map<string, bigint>();
  const grupos = new Map<string, bigint>();
  const baldes = new Map<string, bigint>();
  const nosDoBalde = new Map<string, NoRegistro[]>();
  const valoresPorBalde = new Map<string, Set<string>>();
  let aliquotaCorrente = '';

  for (const no of [...nos].sort((a, b) => a.ordem - b.ordem)) {
    if (no.reg === pai) {
      aliquotaCorrente = campo(no, aliquotaDoPai);
      continue;
    }
    if (no.reg === filho) {
      const k = chave(aliquotaCorrente, campo(no, 2));
      const declaradoNoFilho = campo(no, 4);
      // O mesmo balde e repetido em cada M100 da familia; so somamos uma vez
      // por VALOR distinto, que e o que distingue familias diferentes.
      const vistos = valoresPorBalde.get(k) ?? new Set<string>();
      if (!vistos.has(declaradoNoFilho)) {
        vistos.add(declaradoNoFilho);
        acumula(baldes, k, paraDecimal(declaradoNoFilho));
      }
      valoresPorBalde.set(k, vistos);
      const lista = nosDoBalde.get(k) ?? [];
      lista.push(no);
      nosDoBalde.set(k, lista);
      continue;
    }

    const fonte = fontes[no.reg];
    if (!fonte) continue;
    if (!CST_CREDITO.has(campo(no, fonte.cst).trim())) continue;
    const base = paraDecimal(campo(no, fonte.base));
    if (base === 0n) continue;

    const aliquota = campo(no, fonte.aliquota);
    const nat = campo(no, fonte.nat).trim();
    if (nat !== '') {
      acumula(declarado, chave(aliquota, nat), base);
    } else if (fonte.cfop !== null) {
      acumula(grupos, chave(aliquota, campo(no, fonte.cfop)), base);
    } else {
      // Sem NAT e sem CFOP: nao ha como atribuir. Vai para um grupo proprio,
      // que fara o fechamento falhar se o valor for relevante.
      acumula(grupos, chave(aliquota, `#${no.reg}`), base);
    }
  }

  const baldesDivididos = new Set(
    [...valoresPorBalde.entries()].filter(([, v]) => v.size > 1).map(([k]) => k),
  );

  return { declarado, grupos, baldes, baldesDivididos, nosDoBalde };
}

/** Alíquota de uma chave `"aliquota|x"`. */
const aliquotaDe = (k: string): string => k.slice(0, k.indexOf('|'));
const restoDe = (k: string): string => k.slice(k.indexOf('|') + 1);

/**
 * Resolve quais grupos de CFOP alimentam cada NAT, por alíquota.
 *
 * Busca em profundidade com poda: um grupo so entra num NAT que ainda tem
 * saldo. Para na primeira solucao — ver a nota sobre unicidade no topo.
 */
function resolverAliquota(
  alvos: Map<string, bigint>,
  grupos: [string, bigint][],
): Map<string, string> | null {
  // Do maior para o menor: poda muito mais cedo.
  const ordenados = [...grupos].sort(([a, x], [b, y]) => (y === x ? a.localeCompare(b) : Number(y - x)));
  const restante = new Map(alvos);
  const atribuicao = new Map<string, string>();
  const nats = [...alvos.keys()].sort();

  const anda = (i: number): boolean => {
    if (i === ordenados.length) {
      return [...restante.values()].every((v) => v === 0n);
    }
    const item = ordenados[i];
    if (!item) return false;
    const [grupo, valor] = item;
    for (const nat of nats) {
      const saldo = restante.get(nat) ?? 0n;
      if (saldo < valor) continue;
      restante.set(nat, saldo - valor);
      atribuicao.set(grupo, nat);
      if (anda(i + 1)) return true;
      restante.set(nat, saldo);
      atribuicao.delete(grupo);
    }
    return false;
  };

  return anda(0) ? atribuicao : null;
}

/** Resultado do aprendizado, com o motivo quando nao dá. */
export interface ResultadoAprendizado {
  mapa: MapaAtribuicao;
  avisos: ErroValidacao[];
}

/**
 * Aprende a atribuicao a partir de um arquivo consistente.
 *
 * Chamado na ida TXT -> XLSX, quando o arquivo ainda e o que o PVA aceitou.
 * Sempre devolve um mapa: `fechou` diz em quais tributos ele vale. Gravar o
 * mapa mesmo vazio e o que permite a volta distinguir "planilha antiga" de
 * "arquivo que nunca fechou" — sao situacoes com tratamento oposto.
 */
export function aprenderAtribuicao(nos: NoRegistro[]): ResultadoAprendizado {
  const avisos: ErroValidacao[] = [];
  const mapa: MapaAtribuicao = { pis: {}, cofins: {}, fechou: [] };

  for (const tributo of ['pis', 'cofins'] as const) {
    const { declarado, grupos, baldes } = levantar(nos, tributo);
    if (baldes.size === 0) continue;

    const totalFontes =
      [...declarado.values()].reduce((a, b) => a + b, 0n) +
      [...grupos.values()].reduce((a, b) => a + b, 0n);
    const totalBaldes = [...baldes.values()].reduce((a, b) => a + b, 0n);

    if (totalFontes !== totalBaldes) {
      avisos.push({
        severidade: 'aviso',
        registro: APURACAO[tributo].filho,
        mensagem:
          `Base de crédito de ${tributo.toUpperCase()} não fecha com os documentos ` +
          `(${formatarDecimal(totalFontes)} contra ${formatarDecimal(totalBaldes)}). ` +
          `A reconversão vai bloquear edição que altere a base.`,
      });
      continue;
    }

    // Por alíquota, o que sobra depois das fontes que declaram o NAT.
    const porAliquota = new Map<string, Map<string, bigint>>();
    for (const [k, total] of baldes) {
      const a = aliquotaDe(k);
      const residual = total - (declarado.get(k) ?? 0n);
      if (residual === 0n) continue;
      const alvos = porAliquota.get(a) ?? new Map<string, bigint>();
      alvos.set(restoDe(k), residual);
      porAliquota.set(a, alvos);
    }

    let falhou = false;
    for (const [a, alvos] of porAliquota) {
      const doGrupo = [...grupos.entries()].filter(([k]) => aliquotaDe(k) === a);
      const solucao = resolverAliquota(alvos, doGrupo.map(([k, v]) => [restoDe(k), v]));
      if (!solucao) {
        falhou = true;
        avisos.push({
          severidade: 'aviso',
          registro: APURACAO[tributo].filho,
          mensagem:
            `Não foi possível deduzir a natureza do crédito dos CFOP na alíquota ${a} ` +
            `(${tributo.toUpperCase()}). A reconversão vai bloquear edição que altere a base.`,
        });
        break;
      }
      for (const [cfop, nat] of solucao) mapa[tributo][chave(a, cfop)] = nat;
    }
    if (!falhou) mapa.fechou.push(tributo);
  }

  return { mapa, avisos };
}

export interface ResultadoRecalculo {
  nos: NoRegistro[];
  erros: ErroValidacao[];
  avisos: ErroValidacao[];
}

/**
 * Reescreve M105/M505 campo 4 a partir dos documentos.
 *
 * Só toca no campo cujo valor mudou: sem edicao, o arquivo sai byte a byte
 * igual, que e o que o teste de ouro exige.
 */
export function recalcularBasesDeCredito(
  nos: NoRegistro[],
  mapa: MapaAtribuicao | null,
): ResultadoRecalculo {
  const erros: ErroValidacao[] = [];
  const avisos: ErroValidacao[] = [];

  for (const tributo of ['pis', 'cofins'] as const) {
    const { declarado, grupos, baldes, baldesDivididos, nosDoBalde } = levantar(nos, tributo);
    if (baldes.size === 0) continue;

    // Total novo de cada balde: o que as fontes com NAT declaram mais os
    // grupos de CFOP que o mapa manda para ele.
    const novo = new Map<string, bigint>();
    for (const k of baldes.keys()) novo.set(k, declarado.get(k) ?? 0n);

    const totalFontes =
      [...declarado.values()].reduce((a, b) => a + b, 0n) +
      [...grupos.values()].reduce((a, b) => a + b, 0n);
    const totalBaldes = [...baldes.values()].reduce((a, b) => a + b, 0n);

    // Arquivo cuja base ja nao fechava na origem. Recalcular aqui zeraria
    // bases legitimas — a diferenca vem de fonte de credito que este modulo
    // nao modela, nao de edicao do usuario. Nao mexe e avisa.
    if (mapa !== null && !mapa.fechou.includes(tributo)) {
      avisos.push({
        severidade: 'aviso',
        registro: APURACAO[tributo].filho,
        mensagem:
          `A base de cálculo do crédito de ${tributo.toUpperCase()} não foi recalculada: ` +
          `ela já não fechava com os documentos no arquivo de origem ` +
          `(diferença de ${formatarDecimal(totalBaldes - totalFontes)}). Se você alterou ` +
          `documentos, confira o ${APURACAO[tributo].filho} na planilha.`,
      });
      continue;
    }

    const semMapa: string[] = [];
    for (const [g, valor] of grupos) {
      const nat = mapa?.[tributo]?.[g];
      if (nat === undefined) {
        if (valor !== 0n) semMapa.push(g);
        continue;
      }
      const k = chave(aliquotaDe(g), nat);
      novo.set(k, (novo.get(k) ?? 0n) + valor);
    }

    // Planilha gerada antes desta funcionalidade: nao ha mapa e nao ha como
    // saber se o arquivo fechava. So da para comparar o total geral, que
    // independe do mapa. Igual, segue; diferente, alguem editou a base e nao
    // temos como corrigir.
    if (mapa === null || semMapa.length > 0) {
      if (totalFontes !== totalBaldes) {
        erros.push({
          severidade: 'erro',
          registro: APURACAO[tributo].filho,
          mensagem:
            `A base de cálculo do crédito de ${tributo.toUpperCase()} mudou em ` +
            `${formatarDecimal(totalFontes - totalBaldes)}, mas a natureza do crédito ` +
            (semMapa.length > 0
              ? `dos CFOP ${semMapa.map(restoDe).join(', ')} não é conhecida. `
              : 'não foi gravada nesta planilha. ') +
            `Gere o Excel de novo a partir do TXT original.`,
        });
      }
      continue;
    }

    for (const k of baldes.keys()) {
      const antes = baldes.get(k) ?? 0n;
      const depois = novo.get(k) ?? 0n;
      if (antes === depois) continue;

      const alvos = nosDoBalde.get(k) ?? [];
      const rotulo = `${APURACAO[tributo].filho} NAT_BC_CRED ${restoDe(k)} (alíquota ${aliquotaDe(k)})`;
      const diferenca = formatarDecimal(depois - antes);

      if (baldesDivididos.has(k)) {
        erros.push({
          severidade: 'erro',
          registro: APURACAO[tributo].filho,
          linha: alvos[0]?.linhaOriginal,
          mensagem:
            `A base de cálculo do crédito mudou em ${diferenca} no ${rotulo}, que é ` +
            `declarado com valores diferentes em mais de um M100 — não há como saber ` +
            `qual deles absorve a diferença. Ajuste o ${APURACAO[tributo].filho} na planilha.`,
        });
        continue;
      }

      let cumulativaNaoNula = false;
      for (const no of alvos) {
        const original = no.valores[3] ?? '';
        no.valores[3] = formatarDecimal(depois, Math.max(2, casasDecimais(original)));

        // Campo 6 (VL_BC_*_NC) = campo 4 (TOT) - campo 5 (CUM). O PVA valida
        // esta identidade separadamente: corrigir so o total deixa o arquivo
        // com a parcela nao cumulativa velha e ele recusa de novo.
        const cumulativa = paraDecimal(no.valores[4]);
        if (cumulativa !== 0n) cumulativaNaoNula = true;
        const originalNc = no.valores[5] ?? '';
        no.valores[5] = formatarDecimal(
          depois - cumulativa,
          Math.max(2, casasDecimais(originalNc)),
        );
      }

      avisos.push({
        severidade: 'aviso',
        registro: APURACAO[tributo].filho,
        linha: alvos[0]?.linhaOriginal,
        mensagem:
          `Base de cálculo do crédito recalculada em ${rotulo}: ${formatarDecimal(antes)} ` +
          `→ ${formatarDecimal(depois)} (${diferenca}). Confira a apuração: o crédito ` +
          `aproveitado (campo VL_BC do M105 e o M100) não foi alterado.`,
      });

      if (cumulativaNaoNula) {
        // A diferenca foi toda para a parcela nao cumulativa, porque nao ha
        // como saber como o item removido se dividia entre os dois regimes.
        avisos.push({
          severidade: 'aviso',
          registro: APURACAO[tributo].filho,
          linha: alvos[0]?.linhaOriginal,
          mensagem:
            `Em ${rotulo} a diferença foi lançada inteira na parcela não cumulativa; ` +
            `a parcela cumulativa (VL_BC_*_CUM) ficou como estava. Se o item alterado ` +
            `era vinculado a receita cumulativa, ajuste os dois na planilha.`,
        });
      }
    }
  }

  return { nos, erros, avisos };
}
