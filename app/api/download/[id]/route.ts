// GET /api/download/[id] — signed URL do Supabase Storage, validade de 5 minutos.
// Ver docs/SPEC.md secao 6.
import { dependenciasSupabase } from '@/lib/api/dependencias-supabase';
import { getDownload } from '@/lib/api/download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No Next 15 os params de rota dinamica sao assincronos.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return getDownload(id, await dependenciasSupabase());
}
