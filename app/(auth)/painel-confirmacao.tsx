'use client';

// Substitui o formulário de cadastro assim que a conta é criada (B1). Antes o
// aviso era um <p> cinza espremido entre os campos, e o formulário voltava
// limpo — lido pelo usuário como "não aconteceu nada". Aqui o sucesso vira
// tela própria, com foco movido para ela.
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ReenviarConfirmacao } from './reenviar-confirmacao';

interface Props {
  email: string;
}

export function PainelConfirmacao({ email }: Props) {
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    painelRef.current?.focus();
  }, []);

  return (
    <div
      ref={painelRef}
      role="status"
      tabIndex={-1}
      className="space-y-4 rounded-lg border border-border bg-muted/40 p-6 outline-none"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Confirme seu e-mail</h2>
        <p className="text-sm text-muted-foreground">
          Enviamos um link de confirmação para{' '}
          <span className="font-medium text-foreground">{email}</span>.
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Não encontrou a mensagem? Confira também a caixa de spam.
      </p>

      <ReenviarConfirmacao email={email} />

      <Link href="/login" className="block text-sm font-medium underline underline-offset-4">
        Ir para o login
      </Link>
    </div>
  );
}
