'use client';

// Dropzone, progresso e preview do cabecalho 0000. Ver docs/SPEC.md secao 7.3.
//
// O preview existe para o usuario confirmar que subiu o arquivo CERTO antes de
// gastar uma conversao da cota: CNPJ, razao social e periodo saem do registro
// 0000 que o /api/upload leu.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import {
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import { AvisoCotaEsgotada, type Cota } from '@/components/cota';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatarBytes, formatarCnpj, formatarPeriodo } from '@/lib/formato';
import { ROTULO_DIRECAO } from '../conversao';

interface Enviado {
  arquivo_id: string;
  nome: string;
  tamanho_bytes: number;
  tipo: 'txt' | 'xlsx';
  cabecalho: {
    cnpj: string | null;
    razao_social: string | null;
    periodo_inicio: string | null;
    periodo_fim: string | null;
  };
}

/** A direcao sai da extensao do arquivo, como no CLI. */
const direcaoDe = (tipo: 'txt' | 'xlsx') =>
  tipo === 'txt' ? ('txt_para_xlsx' as const) : ('xlsx_para_txt' as const);

export default function UploadPage() {
  const router = useRouter();
  const [cota, setCota] = useState<Cota | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [enviado, setEnviado] = useState<Enviado | null>(null);
  const [convertendo, setConvertendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/files?por_pagina=1', { credentials: 'include' });
      if (r.ok) setCota((await r.json()).cota);
    })();
  }, []);

  /**
   * Envia com XMLHttpRequest, e nao com fetch, porque so ele reporta progresso
   * de upload. Um TXT de 17 MB leva segundos e a barra e o unico sinal de que
   * a aplicacao nao travou.
   */
  const enviar = useCallback((arquivo: File) => {
    setErro(null);
    setEnviado(null);
    setProgresso(0);

    const dados = new FormData();
    dados.append('arquivo', arquivo);

    const req = new XMLHttpRequest();
    req.open('POST', '/api/upload');
    req.withCredentials = true;

    req.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) setProgresso(Math.round((e.loaded / e.total) * 100));
    });
    req.addEventListener('load', () => {
      setProgresso(null);
      let corpo: { erro?: string } & Partial<Enviado> = {};
      try {
        corpo = JSON.parse(req.responseText);
      } catch {
        setErro('Resposta inesperada do servidor.');
        return;
      }
      if (req.status >= 200 && req.status < 300) setEnviado(corpo as Enviado);
      else setErro(corpo.erro ?? `Falha no envio (HTTP ${req.status}).`);
    });
    req.addEventListener('error', () => {
      setProgresso(null);
      setErro('Falha de rede ao enviar o arquivo.');
    });
    req.send(dados);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    accept: {
      'text/plain': ['.txt'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    onDrop: (aceitos, recusados) => {
      if (recusados.length > 0) {
        setErro('Envie um arquivo .txt da EFD-Contribuições ou uma planilha .xlsx gerada aqui.');
        return;
      }
      const arquivo = aceitos[0];
      if (arquivo) enviar(arquivo);
    },
  });

  async function converter() {
    if (!enviado) return;
    setConvertendo(true);
    setErro(null);
    try {
      const r = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          arquivo_id: enviado.arquivo_id,
          direcao: direcaoDe(enviado.tipo),
        }),
      });
      const corpo = await r.json();
      // 422 = erro de validacao bloqueando o TXT. A tela de detalhe mostra
      // quais, entao vale navegar para la em vez de resumir aqui.
      if (r.ok || r.status === 422) {
        router.push(`/arquivo/${enviado.arquivo_id}`);
        return;
      }
      throw new Error(corpo?.erro ?? `Falha na conversão (HTTP ${r.status}).`);
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : String(causa));
      setConvertendo(false);
    }
  }

  const cotaEsgotada = cota !== null && cota.restantes === 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Enviar arquivo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          TXT da EFD-Contribuições vira planilha. Planilha gerada aqui volta a ser TXT.
        </p>
      </div>

      {cota === null ? (
        <Skeleton className="h-20 w-full" />
      ) : cotaEsgotada ? (
        <AvisoCotaEsgotada cota={cota} />
      ) : null}

      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          isDragActive ? 'border-primary bg-accent' : 'hover:border-muted-foreground/50'
        }`}
      >
        <input {...getInputProps()} aria-label="Escolher arquivo" />
        <UploadCloud className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="mt-4 font-medium">
          {isDragActive ? 'Solte o arquivo aqui' : 'Arraste o arquivo ou clique para escolher'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          .txt ou .xlsx
          {cota ? ` · até ${formatarBytes(cota.tamanho_maximo_bytes)}` : ''}
        </p>
      </div>

      {progresso !== null ? (
        <div className="space-y-2" aria-busy="true">
          <div className="flex justify-between text-sm">
            <span>Enviando…</span>
            <span className="text-muted-foreground">{progresso}%</span>
          </div>
          <Progress value={progresso} aria-label={`Envio em ${progresso}%`} />
        </div>
      ) : null}

      {erro ? (
        <Alert variant="destructive">
          <AlertTitle>Não deu para enviar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      ) : null}

      {enviado ? (
        <section className="rounded-lg border p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
            <h2 className="font-medium">Arquivo recebido</h2>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Campo rotulo="Arquivo">
              <span className="flex items-center gap-2">
                {enviado.tipo === 'txt' ? (
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                ) : (
                  <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate">{enviado.nome}</span>
              </span>
            </Campo>
            <Campo rotulo="Tamanho">{formatarBytes(enviado.tamanho_bytes)}</Campo>
            <Campo rotulo="CNPJ">
              <span className="font-mono">{formatarCnpj(enviado.cabecalho.cnpj) || '—'}</span>
            </Campo>
            <Campo rotulo="Razão social">{enviado.cabecalho.razao_social ?? '—'}</Campo>
            <Campo rotulo="Período">
              {formatarPeriodo(
                enviado.cabecalho.periodo_inicio,
                enviado.cabecalho.periodo_fim,
              ) || '—'}
            </Campo>
            <Campo rotulo="Conversão">{ROTULO_DIRECAO[direcaoDe(enviado.tipo)]}</Campo>
          </dl>

          {enviado.tipo === 'xlsx' ? (
            <p className="mt-4 text-xs text-muted-foreground">
              O CNPJ e o período de uma planilha só aparecem depois da conversão, quando o
              registro 0000 é lido de dentro dela.
            </p>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              Confira o CNPJ e o período antes de converter — a conversão consome uma unidade da
              sua cota.
            </p>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={() => void converter()} disabled={convertendo || cotaEsgotada}>
              {convertendo ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Convertendo…
                </>
              ) : (
                <>
                  Converter
                  <ArrowRight className="size-4" aria-hidden />
                </>
              )}
            </Button>
            {convertendo ? (
              <span className="text-sm text-muted-foreground">
                Arquivos grandes levam alguns minutos. Não feche a página.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
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
