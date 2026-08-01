'use client';

// Última barreira: erro de renderização que escapa de todo o resto.
//
// Sem este arquivo o usuário veria a tela padrão do Next, em inglês e sem
// saída. O `captureException` fica inerte enquanto o SDK de navegador estiver
// desligado (ver docs/DEPLOY.md), mas o registro no console continua e a
// mensagem em português é o que importa aqui.
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
          <h1 className="text-2xl font-bold">Algo quebrou por aqui</h1>
          <p className="text-sm text-neutral-600">
            O erro foi registrado. Nenhum arquivo seu foi perdido — o que estava salvo continua
            no seu painel.
          </p>
          {error.digest ? (
            <p className="text-xs text-neutral-500">
              Código para suporte: <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Tentar de novo
            </button>
            <a
              href="/dashboard"
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              Ir para meus arquivos
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
