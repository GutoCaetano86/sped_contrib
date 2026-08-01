// Detalhe do arquivo. Ver docs/SPEC.md secao 7.4.
//
// Server Component so para resolver os params (assincronos no Next 15); a tela
// em si e cliente, porque precisa de polling e de estado de carregamento.
import { DetalheDoArquivo } from './detalhe';

export default async function ArquivoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DetalheDoArquivo id={id} />;
}
