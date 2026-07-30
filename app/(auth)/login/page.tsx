import Link from 'next/link';
import { entrar, entrarComGoogle } from '../acoes';
import { FormularioAuth } from '../formulario-auth';

export const metadata = { title: 'Entrar — SPED Converter' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ proxima?: string; erro?: string }>;
}) {
  const { proxima, erro } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Entrar</h1>
        <p className="text-sm text-muted-foreground">
          Acesse sua conta para converter arquivos da EFD-Contribuições.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}

      <FormularioAuth
        acao={entrar}
        acaoGoogle={entrarComGoogle}
        rotulo="Entrar"
        proxima={proxima}
      />

      <p className="text-sm text-muted-foreground">
        Ainda não tem conta?{' '}
        <Link href="/cadastro" className="font-medium underline underline-offset-4">
          Criar conta
        </Link>
      </p>
    </main>
  );
}
