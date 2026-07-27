// Detalhe do arquivo: cabecalho, resumo por registro, erros/avisos, downloads.
// Ver docs/SPEC.md secao 7.4 (tarefa F3-T4).

// No Next 15 os params de rota dinamica sao assincronos.
export default async function ArquivoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold">Arquivo {id}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Esqueleto — detalhe da conversão na tarefa F3-T4.
      </p>
    </main>
  );
}
