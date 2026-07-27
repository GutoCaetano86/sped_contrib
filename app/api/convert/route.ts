// POST /api/convert — dispara a conversao e grava a saida no Storage.
// Ver docs/SPEC.md secao 6 (tarefa F3-T3).
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ erro: 'Nao implementado (tarefa F3-T3).' }, { status: 501 });
}
