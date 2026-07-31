// Aritmetica decimal exata para valores do leiaute.
//
// Nao usar `number` aqui: somar 34 mil bases de calculo em ponto flutuante
// acumula erro de centavos, e o PVA compara o total com igualdade exata. Todo
// valor vira `bigint` numa escala fixa.
//
// Modulo puro, como o resto de lib/sped/.

/** Casas decimais internas. 8 cobre aliquota (4) com folga. */
export const ESCALA = 8;

const POTENCIA = 10n ** BigInt(ESCALA);

/**
 * "1.234,56" -> 123456000000n (escala 8).
 *
 * Aceita o formato do leiaute (virgula decimal, sem separador de milhar) e
 * tolera o ponto de milhar, que aparece em planilha que o usuario reformatou.
 * Valor vazio ou ilegivel vira 0 — quem decide se isso e erro e o validador.
 */
export function paraDecimal(texto: string | undefined): bigint {
  const bruto = (texto ?? '').trim();
  if (bruto === '') return 0n;

  const negativo = bruto.startsWith('-');
  const limpo = (negativo ? bruto.slice(1) : bruto).replace(/\./g, '');
  const partes = limpo.split(',');
  // Mais de uma virgula e lixo. Ler "1,2,3" como 1,2 seria pior que zerar:
  // silenciaria um dado corrompido dentro de um total fiscal.
  if (partes.length > 2) return 0n;
  const [inteira = '', fracao = ''] = partes;
  if (!/^\d*$/.test(inteira) || !/^\d*$/.test(fracao)) return 0n;
  if (inteira === '' && fracao === '') return 0n;

  const fracaoAjustada = (fracao + '0'.repeat(ESCALA)).slice(0, ESCALA);
  const valor = BigInt(inteira || '0') * POTENCIA + BigInt(fracaoAjustada || '0');
  return negativo ? -valor : valor;
}

/**
 * 123456000000n -> "1234,56" com o numero de casas pedido.
 *
 * Arredonda meio para cima em modulo, que e a convencao do leiaute para
 * valores monetarios.
 */
export function formatarDecimal(valor: bigint, casas = 2): string {
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;

  const divisor = 10n ** BigInt(ESCALA - casas);
  const arredondado = (absoluto + divisor / 2n) / divisor;

  const potenciaCasas = 10n ** BigInt(casas);
  const inteira = arredondado / potenciaCasas;
  const fracao = arredondado % potenciaCasas;

  const texto =
    casas === 0
      ? String(inteira)
      : `${inteira},${String(fracao).padStart(casas, '0')}`;
  return negativo && arredondado !== 0n ? `-${texto}` : texto;
}

/**
 * Quantas casas decimais o texto declara.
 *
 * Serve para reescrever um campo mantendo o estilo do arquivo de origem: o
 * arquivo real grava "136540291,4" com uma casa so, e reescrever como
 * "136540291,40" mudaria bytes sem necessidade.
 */
export function casasDecimais(texto: string | undefined): number {
  const virgula = (texto ?? '').indexOf(',');
  return virgula === -1 ? 0 : (texto ?? '').length - virgula - 1;
}

/** Arredonda para `casas` decimais, meio para cima em modulo. */
export function arredondar(valor: bigint, casas = 2): bigint {
  const passo = 10n ** BigInt(ESCALA - casas);
  if (passo === 1n) return valor;
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  const arredondado = ((absoluto + passo / 2n) / passo) * passo;
  return negativo ? -arredondado : arredondado;
}

/**
 * Reparte `novoTotal` entre as parcelas, mantendo as proporcoes atuais.
 *
 * Serve para o rateio do credito entre os COD_CRED do bloco M: quando a base
 * muda, cada vinculacao (receita tributada, nao tributada, exportacao) encolhe
 * na mesma proporcao — que e o que o metodo de rateio do registro 0111
 * prescreve. O residuo do arredondamento vai para a maior parcela, para a soma
 * fechar EXATA: o PVA compara com igualdade.
 */
export function ratearProporcional(atuais: bigint[], novoTotal: bigint, casas = 2): bigint[] {
  if (atuais.length === 0) return [];
  const alvo = arredondar(novoTotal, casas);
  const total = atuais.reduce((a, b) => a + b, 0n);

  // Sem base para proporcao: tudo na primeira parcela, que e o unico palpite
  // que nao inventa distribuicao.
  if (total === 0n) return atuais.map((_, i) => (i === 0 ? alvo : 0n));

  const partes = atuais.map((a) => arredondar((a * alvo) / total, casas));
  const residuo = alvo - partes.reduce((a, b) => a + b, 0n);
  if (residuo !== 0n) {
    let maior = 0;
    for (let i = 1; i < partes.length; i++) {
      if ((partes[i] ?? 0n) > (partes[maior] ?? 0n)) maior = i;
    }
    partes[maior] = (partes[maior] ?? 0n) + residuo;
  }
  return partes;
}

/** Soma exata, para deixar a intencao explicita em quem chama. */
export const somar = (valores: Iterable<bigint>): bigint => {
  let total = 0n;
  for (const v of valores) total += v;
  return total;
};
