'use client';

// Painel de erros e avisos agrupado por severidade (spec 7.4).
//
// Agrupa por mensagem: um arquivo de 138 mil linhas produz o MESMO aviso
// milhares de vezes, e listar tudo enterra o que importa. Cada grupo mostra a
// contagem e a primeira ocorrencia, com aba/linha/campo.
import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatarNumero } from '@/lib/formato';

export interface Ocorrencia {
  severidade?: string;
  mensagem?: string;
  linha?: number;
  registro?: string;
  campo?: string;
  aba?: string;
}

interface Grupo {
  chave: string;
  mensagem: string;
  quantidade: number;
  primeira: Ocorrencia;
}

function agrupar(itens: Ocorrencia[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const item of itens) {
    const mensagem = item.mensagem ?? '(sem mensagem)';
    const chave = `${item.registro ?? ''}|${item.campo ?? ''}|${mensagem}`;
    const atual = grupos.get(chave);
    if (atual) atual.quantidade++;
    else grupos.set(chave, { chave, mensagem, quantidade: 1, primeira: item });
  }
  return [...grupos.values()].sort((a, b) => b.quantidade - a.quantidade);
}

function Onde({ item }: { item: Ocorrencia }) {
  const partes = [
    item.aba ? `aba ${item.aba}` : null,
    item.registro ?? null,
    item.campo ?? null,
    item.linha ? `linha ${formatarNumero(item.linha)}` : null,
  ].filter(Boolean);
  if (partes.length === 0) return null;
  return <span className="font-mono text-xs text-muted-foreground">{partes.join(' · ')}</span>;
}

interface Props {
  titulo: string;
  itens: Ocorrencia[];
  /** Total real, que pode ser maior que `itens` por causa do corte da API. */
  total: number;
  severidade: 'erro' | 'aviso';
}

export function PainelOcorrencias({ titulo, itens, total, severidade }: Props) {
  const [aberto, setAberto] = useState(severidade === 'erro');
  if (total === 0) return null;

  const grupos = agrupar(itens);
  const Icone = severidade === 'erro' ? XCircle : AlertTriangle;
  const cor = severidade === 'erro' ? 'text-destructive' : 'text-amber-600';

  return (
    <section className="rounded-lg border">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 p-4 text-left"
      >
        {aberto ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
        <Icone className={`size-4 shrink-0 ${cor}`} aria-hidden />
        <span className="font-medium">{titulo}</span>
        <Badge variant={severidade === 'erro' ? 'destructive' : 'secondary'}>
          {formatarNumero(total)}
        </Badge>
        {total > itens.length ? (
          <span className="text-xs text-muted-foreground">
            mostrando as {formatarNumero(itens.length)} primeiras
          </span>
        ) : null}
      </button>

      {aberto ? (
        <ul className="divide-y border-t">
          {grupos.map((g) => (
            <li key={g.chave} className="flex flex-col gap-1 p-4">
              <div className="flex items-start gap-2">
                {g.quantidade > 1 ? (
                  <Badge variant="outline" className="shrink-0">
                    {formatarNumero(g.quantidade)}×
                  </Badge>
                ) : null}
                <p className="text-sm">{g.mensagem}</p>
              </div>
              <Onde item={g.primeira} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
