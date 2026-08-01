'use client';

// Detalhe do arquivo: cabecalho, resumo por registro, erros/avisos, downloads.
// Ver docs/SPEC.md secao 7.4 e os estados da 7.5.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, RefreshCw } from 'lucide-react';
import { PainelOcorrencias, type Ocorrencia } from '@/components/ocorrencias';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatarBytes,
  formatarCnpj,
  formatarDataHora,
  formatarDuracao,
  formatarNumero,
  formatarPeriodo,
} from '@/lib/formato';
import { EstadoDaConversao, ROTULO_DIRECAO, baixarArquivo } from '../../conversao';

interface Conversao {
  conversao_id: string;
  direcao: 'txt_para_xlsx' | 'xlsx_para_txt';
  status: 'pendente' | 'processando' | 'concluido' | 'erro';
  arquivo_origem_id: string;
  arquivo_saida_id: string | null;
  total_linhas: number | null;
  total_registros: number | null;
  resumo_registros: { reg: string; n: number }[];
  erros: Ocorrencia[];
  avisos: Ocorrencia[];
  duracao_ms: number | null;
  criado_em: string;
  concluido_em: string | null;
}

interface Detalhe {
  arquivo_id: string;
  nome: string;
  tipo: 'txt' | 'xlsx';
  tamanho_bytes: number;
  cnpj: string | null;
  razao_social: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  criado_em: string;
  ultima_conversao: Conversao | null;
}

export function DetalheDoArquivo({ id }: { id: string }) {
  const [dados, setDados] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [convertendo, setConvertendo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/files/${id}`, { credentials: 'include' });
      const corpo = await r.json();
      if (!r.ok) throw new Error(corpo?.erro ?? 'Falha ao carregar o arquivo.');
      setDados(corpo);
      setErro(null);
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : String(causa));
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Polling a cada 2 s enquanto processa (spec 7.5). Sobrevive a recarregar a
  // pagina, porque o estado vem do banco e nao da requisicao em voo.
  const conversao = dados?.ultima_conversao ?? null;
  const processando = conversao?.status === 'processando' || conversao?.status === 'pendente';
  useEffect(() => {
    if (!processando) return;
    const t = setInterval(() => void carregar(), 2000);
    return () => clearInterval(t);
  }, [processando, carregar]);

  async function converter() {
    if (!dados) return;
    setConvertendo(true);
    setErro(null);
    try {
      const r = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          arquivo_id: dados.arquivo_id,
          direcao: dados.tipo === 'txt' ? 'txt_para_xlsx' : 'xlsx_para_txt',
        }),
      });
      if (!r.ok && r.status !== 422) {
        throw new Error((await r.json())?.erro ?? `Falha na conversão (HTTP ${r.status}).`);
      }
      await carregar();
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : String(causa));
    } finally {
      setConvertendo(false);
    }
  }

  if (!dados) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 p-8">
        {erro ? (
          <Alert variant="destructive">
            <AlertTitle>Arquivo não encontrado</AlertTitle>
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        ) : (
          <div aria-busy="true" className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Meus arquivos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{dados.nome}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatarBytes(dados.tamanho_bytes)} · enviado em {formatarDataHora(dados.criado_em)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void baixarArquivo(dados.arquivo_id, setErro)}>
            <Download className="size-4" aria-hidden />
            Baixar original
          </Button>
          {conversao?.arquivo_saida_id ? (
            <Button onClick={() => void baixarArquivo(conversao.arquivo_saida_id!, setErro)}>
              <Download className="size-4" aria-hidden />
              Baixar {dados.tipo === 'txt' ? 'planilha' : 'TXT'}
            </Button>
          ) : (
            <Button onClick={() => void converter()} disabled={convertendo || processando}>
              {convertendo || processando ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Convertendo…
                </>
              ) : (
                <>
                  <RefreshCw className="size-4" aria-hidden />
                  Converter
                </>
              )}
            </Button>
          )}
        </div>
      </header>

      {erro ? (
        <Alert variant="destructive">
          <AlertTitle>Algo deu errado</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      ) : null}

      <dl className="grid gap-x-6 gap-y-4 rounded-lg border p-6 sm:grid-cols-4">
        <Campo rotulo="CNPJ">
          <span className="font-mono">{formatarCnpj(dados.cnpj) || '—'}</span>
        </Campo>
        <Campo rotulo="Razão social">{dados.razao_social ?? '—'}</Campo>
        <Campo rotulo="Período">
          {formatarPeriodo(dados.periodo_inicio, dados.periodo_fim) || '—'}
        </Campo>
        <Campo rotulo="Linhas">
          {conversao?.total_linhas === null || conversao === null
            ? '—'
            : formatarNumero(conversao.total_linhas)}
        </Campo>
      </dl>

      {conversao === null ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <h2 className="font-medium">Ainda não convertido</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Converta para {dados.tipo === 'txt' ? 'planilha Excel' : 'TXT do PVA'}.
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
            <EstadoDaConversao conversao={conversao} />
            <span className="text-sm text-muted-foreground">
              {ROTULO_DIRECAO[conversao.direcao]}
              {conversao.duracao_ms !== null
                ? ` · ${formatarDuracao(conversao.duracao_ms)}`
                : ''}
              {conversao.concluido_em ? ` · ${formatarDataHora(conversao.concluido_em)}` : ''}
            </span>
            {processando ? (
              <span className="text-sm text-muted-foreground">
                atualizando automaticamente…
              </span>
            ) : null}
          </section>

          {/* Estado "erro de conversao com mensagem acionavel" (spec 7.5). */}
          {conversao.status === 'erro' ? (
            <Alert variant="destructive">
              <AlertTitle>A conversão foi bloqueada</AlertTitle>
              <AlertDescription>
                {conversao.direcao === 'xlsx_para_txt'
                  ? 'Gerar um TXT que o PVA recusa é pior que não gerar. Corrija os erros abaixo na planilha e envie de novo.'
                  : 'Não foi possível ler o arquivo. Confira os erros abaixo.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <PainelOcorrencias
            titulo="Erros"
            severidade="erro"
            itens={conversao.erros}
            total={conversao.erros.length}
          />
          <PainelOcorrencias
            titulo="Avisos"
            severidade="aviso"
            itens={conversao.avisos}
            total={conversao.avisos.length}
          />

          {conversao.resumo_registros.length > 0 ? (
            <section className="space-y-3">
              <h2 className="font-medium">
                Registros por tipo
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {formatarNumero(conversao.resumo_registros.length)} tipos
                </span>
              </h2>
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Registro</TableHead>
                      <TableHead className="text-right">Linhas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conversao.resumo_registros.map((r) => (
                      <TableRow key={r.reg}>
                        <TableCell className="font-mono">{r.reg}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatarNumero(r.n)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}
