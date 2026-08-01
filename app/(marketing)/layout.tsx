// Cabecalho e rodape das paginas publicas.
//
// Server Component sem nenhum 'use client': landing e privacidade sao HTML
// estatico, o que mantem o JS da rota proximo de zero e o Lighthouse alto.
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const ANO = new Date().getFullYear();

export default function LayoutMarketing({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="font-semibold">
            SPED Converter
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/cadastro">Criar conta</Link>
            </Button>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <p>© {ANO} SPED Converter</p>
          <nav className="flex gap-4">
            <Link href="/privacidade" className="hover:text-foreground">
              Privacidade e dados
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Entrar
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
