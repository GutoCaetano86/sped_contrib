// Cliente Supabase para Server Components, Server Actions e Route Handlers.
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { CHAVE_PUBLICAVEL, URL_SUPABASE } from './config';

/** No Next 15 `cookies()` e assincrono, entao este helper tambem e. */
export async function criarClienteServidor() {
  const cookieStore = await cookies();

  return createServerClient(URL_SUPABASE(), CHAVE_PUBLICAVEL(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (aGravar) => {
        try {
          for (const { name, value, options } of aGravar) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component nao pode escrever cookie. Nao e problema: o
          // middleware renova a sessao a cada requisicao.
        }
      },
    },
  });
}
