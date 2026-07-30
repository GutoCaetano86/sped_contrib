// Renova a sessao a cada requisicao e protege o grupo de rotas (app).
//
// O middleware e o unico lugar que consegue gravar o cookie renovado: Server
// Component nao pode escrever cookie. Sem ele a sessao expira sem aviso e o
// usuario e deslogado no meio do uso.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Rotas do grupo (app): exigem sessao. */
const PROTEGIDAS = ['/dashboard', '/upload', '/arquivo'];
/** Rotas de autenticacao: quem ja entrou nao deve ver. */
const SO_DESLOGADO = ['/login', '/cadastro'];

const comecaCom = (caminho: string, prefixos: string[]) =>
  prefixos.some((p) => caminho === p || caminho.startsWith(`${p}/`));

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

  const { pathname } = request.nextUrl;

  if (!user && comecaCom(pathname, PROTEGIDAS)) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/login';
    // Guarda para onde voltar depois de entrar.
    destino.searchParams.set('proxima', pathname);
    return NextResponse.redirect(destino);
  }

  if (user && comecaCom(pathname, SO_DESLOGADO)) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/dashboard';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  return resposta;
}

export const config = {
  matcher: [
    // Tudo, menos estatico do Next, imagens e favicon. O callback de OAuth
    // fica de fora: ele precisa gravar o cookie de sessao por conta propria.
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
