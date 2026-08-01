'use client';

// Lista de arquivos + barra de cota. Ver docs/SPEC.md secao 7.2 e 7.5.
//
// Cliente, e nao Server Component, de proposito: a spec 7.5 exige skeleton de
// carregamento e polling do estado "processando", e os dois precisam de estado
// no navegador.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet, FileText, Trash2, Upload } from 'lucide-react';
import { BarraCota, type Cota } from '@/components/cota';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatarCnpj, formatarDataHora, formatarPeriodo } from '@/lib/formato';
import { EstadoDaConversao, baixarArquivo, type ResumoConversao } from '../conversao';

interface ArquivoDaLista {
  arquivo_id: string;
  nome: string;
  tipo: 'txt' | 'xlsx';
  tamanho_bytes: number;
  cnpj: string | null;
  razao_social: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  criado_em: string;
  ultima_conversao: ResumoConversao | null;
}

interface Resposta {
  total: number;
  arquivos: ArquivoDaLista[];
  cota: Cota;
}

export default function DashboardPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/files?por_pagina=50', { credentials: 'include' });
      const corpo = await r.json();
      if (!r.ok) throw new Error(corpo?.erro ?? 'Falha ao carregar os arquivos.');
      setDados(corpo);
      setErro(null);
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : String(causa));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Polling enquanto houver conversao em andamento (spec 7.5).
  const processando = dados?.arquivos.some((a) => a.ultima_conversao?.status === 'processando');
  useEffect(() => {
    if (!processando) return;
    const id = setInterval(() => void carregar(), 2000);
    return () => clearInterval(id);
  }, [processando, carregar]);

  async function excluir(arquivoId: string, nome: string) {
    if (!confirm(`Excluir "${nome}" permanentemente? Isto remove o arquivo do servidor.`)) return;
    setExcluindo(arquivoId);
    try {
      const r = await fetch(`/api/files/${arquivoId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error((await r.json())?.erro ?? 'Falha ao excluir.');
      await carregar();
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : String(causa));
    } finally {
      setExcluindo(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Meus arquivos</h1>
        <Button asChild>
          <Link href="/upload">
            <Upload className="size-4" aria-hidden />
            Enviar arquivo
          </Link>
        </Button>
      </div>

      {erro ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      ) : null}

      {dados ? <BarraCota cota={dados.cota} /> : <Skeleton className="h-24 w-full" />}

      {!dados ? (
        <TabelaCarregando />
      ) : dados.arquivos.length === 0 ? (
        <SemArquivos />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enviado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.arquivos.map((a) => (
              <TableRow key={a.arquivo_id}>
                <TableCell>
                  <Link
                    href={`/arquivo/${a.arquivo_id}`}
                    className="flex items-center gap-2 font-medium hover:underline"
                  >
                    {a.tipo === 'txt' ? (
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <FileSpreadsheet
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span className="max-w-[18rem] truncate">{a.nome}</span>
                  </Link>
                  {a.razao_social ? (
                    <span className="ml-6 block max-w-[18rem] truncate text-xs text-muted-foreground">
                      {a.razao_social}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{formatarCnpj(a.cnpj)}</TableCell>
                <TableCell>{formatarPeriodo(a.periodo_inicio, a.periodo_fim)}</TableCell>
                <TableCell>
                  {a.ultima_conversao ? (
                    <EstadoDaConversao conversao={a.ultima_conversao} />
                  ) : (
                    <Badge variant="outline">não convertido</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatarDataHora(a.criado_em)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void baixarArquivo(a.arquivo_id, setErro)}
                      title="Baixar"
                    >
                      <Download className="size-4" aria-hidden />
                      <span className="sr-only">Baixar {a.nome}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={excluindo === a.arquivo_id}
                      onClick={() => void excluir(a.arquivo_id, a.nome)}
                      title="Excluir"
                    >
                      <Trash2 className="size-4 text-destructive" aria-hidden />
                      <span className="sr-only">Excluir {a.nome}</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}

/** Estado "carregando" da spec 7.5. */
function TabelaCarregando() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando arquivos">
      <Skeleton className="h-10 w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** Estado "vazio" da spec 7.5. */
function SemArquivos() {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h2 className="mt-4 font-medium">Nenhum arquivo ainda</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Envie o TXT da sua EFD-Contribuições para receber uma planilha editável — uma aba por
        tipo de registro.
      </p>
      <Button asChild className="mt-6">
        <Link href="/upload">
          <Upload className="size-4" aria-hidden />
          Enviar o primeiro arquivo
        </Link>
      </Button>
    </div>
  );
}
