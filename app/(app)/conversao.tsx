'use client';

// Peças compartilhadas entre dashboard e detalhe: o selo de estado da
// conversão e o download por signed URL.
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface ResumoConversao {
  conversao_id: string;
  direcao: 'txt_para_xlsx' | 'xlsx_para_txt';
  status: 'pendente' | 'processando' | 'concluido' | 'erro';
  arquivo_saida_id: string | null;
  total_linhas: number | null;
  total_registros: number | null;
  total_erros?: number;
  total_avisos?: number;
  duracao_ms: number | null;
  criado_em: string;
  concluido_em: string | null;
}

export const ROTULO_DIRECAO: Record<ResumoConversao['direcao'], string> = {
  txt_para_xlsx: 'TXT → Excel',
  xlsx_para_txt: 'Excel → TXT',
};

/** Selo de estado. "processando" gira, porque a lista faz polling (spec 7.5). */
export function EstadoDaConversao({ conversao }: { conversao: ResumoConversao }) {
  if (conversao.status === 'processando' || conversao.status === 'pendente') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        processando
      </Badge>
    );
  }
  if (conversao.status === 'erro') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" aria-hidden />
        erro
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-emerald-600/40 text-emerald-700">
      <CheckCircle2 className="size-3" aria-hidden />
      {ROTULO_DIRECAO[conversao.direcao]}
    </Badge>
  );
}

/**
 * Baixa pelo /api/download/[id], que devolve signed URL de 5 minutos.
 *
 * Os buckets sao privados (spec 8): nao ha URL permanente para colocar num
 * href. Por isso o download passa por aqui em vez de ser um link simples.
 */
export async function baixarArquivo(
  arquivoId: string,
  aoFalhar: (mensagem: string) => void,
): Promise<void> {
  try {
    const r = await fetch(`/api/download/${arquivoId}`, { credentials: 'include' });
    const corpo = await r.json();
    if (!r.ok) throw new Error(corpo?.erro ?? 'Falha ao gerar o link de download.');

    const link = document.createElement('a');
    link.href = corpo.url;
    link.download = corpo.nome ?? '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (causa) {
    aoFalhar(causa instanceof Error ? causa.message : String(causa));
  }
}
