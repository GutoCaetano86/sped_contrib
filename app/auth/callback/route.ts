// Callback do OAuth e da confirmacao de e-mail.
//
// Trata DOIS fluxos, porque o Supabase usa um para cada caso e eles nao sao
// interchangeaveis:
//
//   ?code=...                    OAuth (PKCE). O `code` so vale com o code
//                                verifier que ficou em cookie no navegador
//                                que INICIOU o login.
//   ?token_hash=...&type=...     confirmacao de e-mail e magic link. Sem
//                                estado, entao funciona mesmo se o link for
//                                aberto em outro navegador ou aparelho.
//
// Tratar so o `code` quebra a confirmacao de e-mail no caso mais comum: a
// pessoa se cadastra no computador e abre o e-mail no celular. O erro que
// aparece e "PKCE code verifier not found in storage".
//
// Esta rota fica FORA do matcher do middleware: ela mesma grava o cookie de
// sessao.
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { criarClienteServidor } from '@/lib/supabase/server';

/** Aceita so caminho interno, para nao virar open redirect. */
const destinoSeguro = (valor: string | null): string =>
  valor && /^\/(?!\/)/.test(valor) ? valor : '/dashboard';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const paraLogin = (motivo: string) =>
    NextResponse.redirect(`${origin}/login?erro=${encodeURIComponent(motivo)}`);

  const erroProvedor = searchParams.get('error_description') ?? searchParams.get('error');
  if (erroProvedor) return paraLogin(erroProvedor);

  const supabase = await criarClienteServidor();
  const destino = destinoSeguro(searchParams.get('proxima'));

  // --- confirmacao de e-mail / magic link ---------------------------------
  const tokenHash = searchParams.get('token_hash');
  const tipo = searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && tipo) {
    const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
    if (error) return paraLogin(error.message);
    return NextResponse.redirect(`${origin}${destino}`);
  }

  // --- OAuth --------------------------------------------------------------
  const code = searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return paraLogin(error.message);
    return NextResponse.redirect(`${origin}${destino}`);
  }

  return paraLogin('Link de autenticação inválido ou incompleto.');
}
