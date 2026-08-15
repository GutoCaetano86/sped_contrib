// POST /api/upload/confirmar — passo 3 do upload direto (ver lib/api/upload.ts).
//
// Baixa o que foi gravado no Storage, revalida e registra em `arquivos`.
import { dependenciasSupabase } from '@/lib/api/dependencias-supabase';
import { postConfirmarUpload } from '@/lib/api/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Baixa e valida o arquivo inteiro; um TXT de 17 MB nao cabe em 60 s de teto. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return postConfirmarUpload(request, await dependenciasSupabase());
}
