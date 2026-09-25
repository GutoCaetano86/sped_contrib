// POST /api/upload/assinar — passo 1 do upload direto (ver lib/api/upload.ts).
//
// Devolve URL assinada para o navegador enviar o arquivo direto ao Storage. O
// corpo desta requisicao e so o nome e o tamanho, entao ela nunca chega perto
// do limite de 4,5 MB da plataforma.
import { dependenciasSupabase } from '@/lib/api/dependencias-supabase';
import { postAssinarUpload } from '@/lib/api/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return postAssinarUpload(request, await dependenciasSupabase());
}
