// POST /api/upload — recebe TXT ou XLSX. Ver docs/SPEC.md secao 6.
//
// A rota e so o adaptador: a logica esta em lib/api/upload.ts, que recebe as
// dependencias por parametro e por isso tem teste de integracao offline.
import { dependenciasSupabase } from '@/lib/api/dependencias-supabase';
import { postUpload } from '@/lib/api/upload';

// Buffer e createHash precisam do runtime Node; o Edge nao serve.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return postUpload(request, await dependenciasSupabase());
}
