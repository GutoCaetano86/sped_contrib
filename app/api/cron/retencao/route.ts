// GET /api/cron/retencao — job diario que apaga arquivo vencido (spec 8).
//
// Agendado em vercel.json. Protegido por CRON_SECRET: ver lib/api/retencao.ts.
// Passe ?simular=1 para ver o que seria apagado sem apagar nada.
import { dependenciasRetencao } from '@/lib/api/retencao-supabase';
import { executarRetencao } from '@/lib/api/retencao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Varre todos os perfis; com base grande isso passa dos 60 s padrao. */
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return executarRetencao(request, dependenciasRetencao());
}
