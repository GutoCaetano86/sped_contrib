'use client';

// Reenvio de confirmação de cadastro (B2). Um único componente serve os dois
// lugares que o bug pedia: dentro do PainelConfirmacao, com o e-mail já
// conhecido (campo oculto, formulário sempre aberto); e no /login, atrás do
// link "Não recebeu o e-mail?", com campo de e-mail visível.
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reenviarConfirmacao } from './acoes';

function BotaoReenviar() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? 'Enviando…' : 'Reenviar e-mail de confirmação'}
    </Button>
  );
}

interface Props {
  /** Quando presente, o formulário já abre com este e-mail (campo oculto). */
  email?: string;
}

export function ReenviarConfirmacao({ email }: Props) {
  const [aberto, setAberto] = useState(Boolean(email));
  const [estado, enviar] = useActionState(reenviarConfirmacao, {});

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-sm font-medium underline underline-offset-4"
      >
        Não recebeu o e-mail de confirmação?
      </button>
    );
  }

  return (
    <form action={enviar} className="space-y-2">
      {email ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email-reenvio">E-mail</Label>
          <Input
            id="email-reenvio"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="voce@empresa.com.br"
          />
        </div>
      )}

      {estado.reenvioMensagem ? (
        <p role="status" className="text-sm text-muted-foreground">
          {estado.reenvioMensagem}
        </p>
      ) : null}
      {estado.erro ? (
        <p role="alert" className="text-sm text-destructive">
          {estado.erro}
        </p>
      ) : null}

      <BotaoReenviar />
    </form>
  );
}
