'use client';

// Formulario compartilhado por /login e /cadastro. Cliente porque precisa de
// useActionState para mostrar o erro sem recarregar a pagina.
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EstadoAuth } from './acoes';

function BotaoEnviar({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? 'Aguarde…' : children}
    </Button>
  );
}

interface Props {
  acao: (anterior: EstadoAuth, dados: FormData) => Promise<EstadoAuth>;
  acaoGoogle: () => Promise<void>;
  rotulo: string;
  /** Cadastro pede o nome; login, não. */
  pedirNome?: boolean;
  proxima?: string;
}

export function FormularioAuth({ acao, acaoGoogle, rotulo, pedirNome, proxima }: Props) {
  const [estado, enviar] = useActionState(acao, {});

  return (
    <div className="space-y-4">
      <form action={enviar} className="space-y-4">
        {proxima ? <input type="hidden" name="proxima" value={proxima} /> : null}

        {pedirNome ? (
          <div className="space-y-2">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" name="nome" autoComplete="name" placeholder="Seu nome" />
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="voce@empresa.com.br"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="senha">Senha</Label>
          <Input
            id="senha"
            name="senha"
            type="password"
            required
            minLength={6}
            autoComplete={pedirNome ? 'new-password' : 'current-password'}
          />
        </div>

        {estado.erro ? (
          <p role="alert" className="text-sm text-destructive">
            {estado.erro}
          </p>
        ) : null}
        {estado.aviso ? (
          <p role="status" className="text-sm text-muted-foreground">
            {estado.aviso}
          </p>
        ) : null}

        <BotaoEnviar>{rotulo}</BotaoEnviar>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">ou</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={acaoGoogle}>
        <Button type="submit" variant="outline" className="w-full">
          Continuar com Google
        </Button>
      </form>
    </div>
  );
}
