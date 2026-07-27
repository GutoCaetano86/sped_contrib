// GET /api/download/[id] — signed URL do Supabase Storage, validade de 5 minutos.
// Ver docs/SPEC.md secao 6 (tarefa F3-T3).
import { NextResponse } from 'next/server';

// No Next 15 os params de rota dinamica sao assincronos.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  return NextResponse.json({ erro: 'Nao implementado (tarefa F3-T3).' }, { status: 501 });
}
