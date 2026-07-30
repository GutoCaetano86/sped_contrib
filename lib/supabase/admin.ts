// Cliente com service role. IGNORA a RLS, entao roda so no servidor e nunca
// e exposto ao browser.
//
// Uso previsto: job de retencao que apaga arquivo vencido (spec 8) e
// operacoes administrativas. Para qualquer coisa em nome do usuario, use
// criarClienteServidor(), que respeita a RLS.
import { createClient } from '@supabase/supabase-js';
import { URL_SUPABASE } from './config';

export function criarClienteAdmin() {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY nao definida.');
  }
  if (typeof window !== 'undefined') {
    throw new Error('criarClienteAdmin() nao pode ser chamado no browser.');
  }

  return createClient(URL_SUPABASE(), chave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
