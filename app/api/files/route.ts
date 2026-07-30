// GET /api/files?pagina=1&por_pagina=20 — lista paginada de arquivos e conversoes.
// Ver docs/SPEC.md secao 6.
import { dependenciasSupabase } from '@/lib/api/dependencias-supabase';
import { getFiles } from '@/lib/api/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return getFiles(request, await dependenciasSupabase());
}
