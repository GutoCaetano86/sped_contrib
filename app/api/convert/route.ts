// POST /api/convert — dispara a conversao e grava a saida no Storage.
// Ver docs/SPEC.md secao 6.
import { dependenciasSupabase } from '@/lib/api/dependencias-supabase';
import { postConvert } from '@/lib/api/convert';

// exceljs e Buffer precisam do runtime Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Teto de execucao, em segundos.
 *
 * Medicao real: 35,6 s para o arquivo de 17 MB, so na geracao do Excel. Os 60 s
 * padrao da Vercel nao cobrem um arquivo do tamanho que o plano pro permite
 * (50 MB, projetado em ~105 s). Ver "Desempenho medido" no CLAUDE.md: a
 * alternativa registrada e mover arquivo grande para Edge Function.
 */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return postConvert(request, await dependenciasSupabase());
}
