'use server';

// Acoes de autenticacao. Ficam no servidor para a senha nunca transitar por
// codigo de browser e para o cookie de sessao ser gravado com HttpOnly.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';

export interface EstadoAuth {
  erro?: string;
  /** E-mail para o qual o cadastro acabou de mandar confirmação. */
  emailConfirmacaoPendente?: string;
}

/** Destino seguro pos-login: so caminho interno, nunca URL absoluta. */
function destinoSeguro(valor: FormDataEntryValue | null): string {
  const caminho = typeof valor === 'string' ? valor : '';
  // Recusa "//host" e "http://host", que sairiam do app (open redirect).
  return /^\/(?!\/)/.test(caminho) ? caminho : '/dashboard';
}

/** Mensagens do Supabase vem em ingles; traduz as mais comuns. */
function traduzir(mensagem: string): string {
  const mapa: Record<string, string> = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
    'User already registered': 'Já existe conta com este e-mail.',
    'Password should be at least 6 characters':
      'A senha precisa de pelo menos 6 caracteres.',
    'Unable to validate email address: invalid format': 'E-mail em formato inválido.',
  };
  return mapa[mensagem] ?? mensagem;
}

export async function entrar(_anterior: EstadoAuth, dados: FormData): Promise<EstadoAuth> {
  const email = String(dados.get('email') ?? '').trim();
  const senha = String(dados.get('senha') ?? '');
  if (!email || !senha) return { erro: 'Informe e-mail e senha.' };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: traduzir(error.message) };

  redirect(destinoSeguro(dados.get('proxima')));
}

export async function cadastrar(_anterior: EstadoAuth, dados: FormData): Promise<EstadoAuth> {
  const email = String(dados.get('email') ?? '').trim();
  const senha = String(dados.get('senha') ?? '');
  const nome = String(dados.get('nome') ?? '').trim();

  if (!email || !senha) return { erro: 'Informe e-mail e senha.' };
  if (senha.length < 6) return { erro: 'A senha precisa de pelo menos 6 caracteres.' };

  const origem = (await headers()).get('origin') ?? '';
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: {
      data: { nome },
      emailRedirectTo: `${origem}/auth/callback`,
    },
  });
  if (error) return { erro: traduzir(error.message) };

  // Com confirmacao de e-mail ligada no projeto, o Supabase devolve o usuario
  // sem sessao: nao da para redirecionar para o dashboard ainda.
  if (data.user && !data.session) {
    return { emailConfirmacaoPendente: email };
  }

  redirect('/dashboard');
}

/**
 * Devolve `void` porque e usada direto como `action` de form. O erro volta
 * pela query da propria pagina de login, ja que nao ha estado para carregar.
 */
export async function entrarComGoogle(): Promise<void> {
  const origem = (await headers()).get('origin') ?? '';
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origem}/auth/callback` },
  });

  if (error || !data.url) {
    const motivo = error
      ? traduzir(error.message)
      : 'Não foi possível iniciar o login com Google.';
    redirect(`/login?erro=${encodeURIComponent(motivo)}`);
  }

  redirect(data.url);
}

export async function sair(): Promise<void> {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect('/login');
}
