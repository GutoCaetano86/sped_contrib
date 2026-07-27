// GET /api/files?pagina=1&por_pagina=20 — lista paginada de arquivos e conversoes.
// Ver docs/SPEC.md secao 6 (tarefa F3-T3).
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ erro: 'Nao implementado (tarefa F3-T3).' }, { status: 501 });
}
