// GET  /api/files/[id] — detalhe do arquivo e da conversao (spec 7.4) e fonte
//                        do polling do estado "processando" (spec 7.5).
// DELETE /api/files/[id] — exclusao permanente: Storage e banco (spec 8).
import { deleteArquivo, getArquivo } from '@/lib/api/arquivo';
import { dependenciasSupabase } from '@/lib/api/dependencias-supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return getArquivo(id, await dependenciasSupabase());
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return deleteArquivo(id, await dependenciasSupabase());
}
