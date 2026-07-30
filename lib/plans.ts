// Limites por plano. Ver docs/SPEC.md secao 4.1.
//
// Modulo puro, sem import de Supabase: a checagem de cota roda em
// /api/convert (spec 6) e tambem alimenta a barra de cota do dashboard
// (spec 7.2), entao precisa servir a servidor e a browser.

export type Plano = 'free' | 'pro' | 'escritorio';

export interface LimitesPlano {
  /** Rotulo para a interface. */
  rotulo: string;
  /** Conversoes permitidas no mes corrente. */
  conversoesPorMes: number;
  /** Tamanho maximo de upload, em bytes. */
  tamanhoMaximoBytes: number;
  /** Dias que o arquivo fica no Storage antes do job de retencao apagar. */
  retencaoDias: number;
  /** Preco sugerido em reais; 0 no plano gratuito. */
  precoMensalReais: number;
}

const MB = 1024 * 1024;

export const PLANOS: Readonly<Record<Plano, LimitesPlano>> = {
  free: {
    rotulo: 'Gratuito',
    conversoesPorMes: 3,
    tamanhoMaximoBytes: 5 * MB,
    retencaoDias: 1, // a spec fala em 24 h
    precoMensalReais: 0,
  },
  pro: {
    rotulo: 'Pro',
    conversoesPorMes: 50,
    tamanhoMaximoBytes: 50 * MB,
    retencaoDias: 30,
    precoMensalReais: 79,
  },
  escritorio: {
    rotulo: 'Escritório',
    conversoesPorMes: 500,
    tamanhoMaximoBytes: 200 * MB,
    retencaoDias: 90,
    precoMensalReais: 249,
  },
};

/**
 * Limite de conversoes por hora, igual em todos os planos.
 * Rate limiting da spec 8, independente da cota mensal.
 */
export const CONVERSOES_POR_HORA = 10;

/** O plano de quem acabou de se cadastrar (default da coluna `plano`). */
export const PLANO_PADRAO: Plano = 'free';

/** `true` se o valor e um plano valido — os mesmos do check da tabela `perfis`. */
export function ehPlano(valor: unknown): valor is Plano {
  return typeof valor === 'string' && Object.hasOwn(PLANOS, valor);
}

/**
 * Limites do plano. Valor desconhecido cai no gratuito, que e o mais
 * restritivo: se o dado do banco vier corrompido, o erro deve ser negar
 * demais e nunca liberar demais.
 */
export function limitesDe(plano: unknown): LimitesPlano {
  return PLANOS[ehPlano(plano) ? plano : PLANO_PADRAO];
}

export interface ResultadoLimite {
  permitido: boolean;
  /** Mensagem pronta para a interface; vazia quando permitido. */
  motivo: string;
}

/** Confere a cota mensal antes de processar (spec 6, POST /api/convert). */
export function conferirCota(
  plano: unknown,
  conversoesNoMes: number,
): ResultadoLimite & { restantes: number } {
  const limites = limitesDe(plano);
  const restantes = Math.max(0, limites.conversoesPorMes - conversoesNoMes);

  if (restantes > 0) return { permitido: true, motivo: '', restantes };
  return {
    permitido: false,
    motivo:
      `Cota do plano ${limites.rotulo} esgotada: ` +
      `${limites.conversoesPorMes} conversões por mês.`,
    restantes: 0,
  };
}

const emMb = (bytes: number): string =>
  (bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1).replace('.', ',');

/** Confere o tamanho do upload antes de subir ao Storage (spec 6). */
export function conferirTamanho(plano: unknown, tamanhoBytes: number): ResultadoLimite {
  const limites = limitesDe(plano);
  if (tamanhoBytes <= limites.tamanhoMaximoBytes) {
    return { permitido: true, motivo: '' };
  }
  return {
    permitido: false,
    motivo:
      `Arquivo de ${emMb(tamanhoBytes)} MB excede o limite de ` +
      `${emMb(limites.tamanhoMaximoBytes)} MB do plano ${limites.rotulo}.`,
  };
}
