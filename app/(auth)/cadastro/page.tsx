import Link from 'next/link';
import { cadastrar, entrarComGoogle } from '../acoes';
import { FormularioAuth } from '../formulario-auth';

export const metadata = { title: 'Criar conta — SPED Converter' };

export default function CadastroPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Criar conta</h1>
        <p className="text-sm text-muted-foreground">
          O plano gratuito permite 3 conversões por mês.
        </p>
      </div>

      <FormularioAuth
        acao={cadastrar}
        acaoGoogle={entrarComGoogle}
        rotulo="Criar conta"
        pedirNome
      />

      <p className="text-sm text-muted-foreground">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </main>
  );
}
