// Callback do OAuth e da confirmacao de e-mail.
//
// O Supabase redireciona para ca com um `code`; trocamos por sessao e
// gravamos o cookie. Esta rota fica FORA do matcher do middleware: ela
// mesma precisa gravar o cookie de sessao.
import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const erroProvedor = searchParams.get('error_description') ?? searchParams.get('error');

  if (erroProvedor) {
    return NextResponse.redirect(`${origin}/login?erro=${encodeURIComponent(erroProvedor)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/login?erro=${encodeURIComponent('Código de autenticação ausente.')}`);
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?erro=${encodeURIComponent(error.message)}`);
  }

  // `proxima` so e aceita se for caminho interno, para nao virar open redirect.
  const proxima = searchParams.get('proxima') ?? '';
  const destino = /^\/(?!\/)/.test(proxima) ? proxima : '/dashboard';
  return NextResponse.redirect(`${origin}${destino}`);
}
