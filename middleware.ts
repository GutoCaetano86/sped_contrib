// Renova a sessao a cada requisicao e protege as rotas autenticadas.
//
// O middleware e o unico lugar que consegue gravar o cookie renovado: Server
// Component nao pode escrever cookie. Sem ele a sessao expira sem aviso e o
// usuario e deslogado no meio do uso.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Rotas PUBLICAS. Todo o resto exige sessao.
 *
 * A lista e de exceções, e nao de rotas protegidas, de proposito: assim
 * esquecer de cadastrar uma rota nova a deixa protegida — chato, mas seguro.
 * Com uma lista de protegidas, o esquecimento deixaria a rota ABERTA.
 */
const PUBLICAS = ['/', '/login', '/cadastro', '/privacidade', '/auth'];

/** Rotas de autenticacao: quem ja entrou nao deve ver. */
const SO_DESLOGADO = ['/login', '/cadastro'];

const casa = (caminho: string, prefixos: string[]) =>
  prefixos.some((p) => caminho === p || caminho.startsWith(p === '/' ? '/@nunca' : `${p}/`));

export async function middleware(request: NextRequest) {
  let resposta = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Sem configuracao o app nao tem como autenticar ninguem; deixa passar em
  // vez de derrubar toda requisicao com excecao.
  if (!url || !chave) return resposta;

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (aGravar) => {
        for (const { name, value } of aGravar) request.cookies.set(name, value);
        resposta = NextResponse.next({ request });
        for (const { name, value, options } of aGravar) {
          resposta.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() valida o token no servidor. getSession() apenas le o cookie e
  // nao serve para decidir acesso.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /**
   * Redireciona PRESERVANDO os cookies que `setAll` gravou.
   *
   * Sem isto a renovacao de token se perde: `getUser()` renova, grava o
   * cookie novo em `resposta`, e um `NextResponse.redirect` limpo o
   * descartaria. Como o refresh token do Supabase e de uso unico, o antigo ja
   * foi consumido e o usuario cai deslogado sem motivo aparente.
   */
  const redirecionar = (destino: URL) => {
    const saida = NextResponse.redirect(destino);
    for (const cookie of resposta.cookies.getAll()) saida.cookies.set(cookie);
    return saida;
  };

  const { pathname } = request.nextUrl;
  const publica = pathname === '/' || casa(pathname, PUBLICAS);

  if (!user && !publica) {
    // Rota de API responde 401 em JSON; redirecionar para HTML de login
    // quebraria o cliente que espera JSON (spec 6).
    if (pathname.startsWith('/api/')) {
      const saida = NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });
      for (const cookie of resposta.cookies.getAll()) saida.cookies.set(cookie);
      return saida;
    }
    const destino = request.nextUrl.clone();
    destino.pathname = '/login';
    destino.search = '';
    // Guarda para onde voltar depois de entrar.
    destino.searchParams.set('proxima', pathname);
    return redirecionar(destino);
  }

  if (user && casa(pathname, SO_DESLOGADO)) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/dashboard';
    destino.search = '';
    return redirecionar(destino);
  }

  return resposta;
}

export const config = {
  matcher: [
    // Tudo, menos estatico do Next, imagens e favicon. O callback de OAuth
    // fica de fora: ele precisa gravar o cookie de sessao por conta propria.
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)',
  ],
};
