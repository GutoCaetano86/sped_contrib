// Formatacao para a interface (F3-T4). Funcoes puras, sem React.

/** 39189437736165 -> "39.189.437/7361-65". Devolve o cru se nao tiver 14 dígitos. */
export function formatarCnpj(valor: string | null | undefined): string {
  const so = (valor ?? '').replace(/\D/g, '');
  if (so.length !== 14) return valor ?? '';
  return `${so.slice(0, 2)}.${so.slice(2, 5)}.${so.slice(5, 8)}/${so.slice(8, 12)}-${so.slice(12)}`;
}

/** "2021-12-01" -> "01/12/2021". */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  const partes = iso.slice(0, 10).split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

/** Período da escrituração, compacto quando cabe no mesmo mês. */
export function formatarPeriodo(
  inicio: string | null | undefined,
  fim: string | null | undefined,
): string {
  if (!inicio && !fim) return '';
  if (!inicio || !fim) return formatarData(inicio ?? fim);
  const [ai, mi] = inicio.slice(0, 7).split('-');
  const [af, mf] = fim.slice(0, 7).split('-');
  // 01/12/2021 a 31/12/2021 vira "12/2021": e como o contador fala do período.
  if (ai === af && mi === mf) return `${mi}/${ai}`;
  return `${formatarData(inicio)} a ${formatarData(fim)}`;
}

/** Data e hora local, curtas, para a coluna "enviado em". */
export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const UNIDADES = ['B', 'KB', 'MB', 'GB'] as const;

/** 5242880 -> "5 MB". */
export function formatarBytes(bytes: number): string {
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < UNIDADES.length - 1) {
    valor /= 1024;
    i++;
  }
  // Uma casa só quando ela diz alguma coisa: "5 MB" lê melhor que "5,0 MB".
  const casas = i === 0 || valor >= 100 || Number.isInteger(valor) ? 0 : 1;
  return `${valor.toFixed(casas).replace('.', ',')} ${UNIDADES[i]}`;
}

/** 138100 -> "138.100". */
export const formatarNumero = (n: number): string => n.toLocaleString('pt-BR');

/** Duração de conversão, para o detalhe. */
export function formatarDuracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
