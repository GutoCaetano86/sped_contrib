// Layout das rotas autenticadas. O middleware ja barrou quem nao tem sessao;
// aqui so montamos o cabecalho com a identificacao e o botao de sair.
import Link from 'next/link';
import { sair } from '@/app/(auth)/acoes';
import { Button } from '@/components/ui/button';
import { criarClienteServidor } from '@/lib/supabase/server';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="font-semibold">
              SPED Converter
            </Link>
            <Link href="/upload" className="text-muted-foreground hover:text-foreground">
              Enviar arquivo
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <form action={sair}>
              <Button type="submit" variant="outline" size="sm">
                Sair
              </Button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
