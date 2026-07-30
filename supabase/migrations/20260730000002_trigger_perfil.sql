-- Cria a linha em `perfis` automaticamente ao inserir em auth.users.
--
-- Sem isto o nome coletado no cadastro fica so no raw_user_meta_data e o
-- resto do app nao tem onde ler plano nem empresa.

create or replace function public.criar_perfil_para_novo_usuario()
returns trigger
language plpgsql
-- security definer para escrever em `perfis` apesar da RLS; o insert vem do
-- trigger, nao de um usuario autenticado.
security definer
-- search_path fixo: sem isto um schema malicioso no caminho poderia
-- sequestrar a resolucao de nomes dentro de uma funcao com privilegio.
set search_path = public, pg_temp
as $$
begin
  insert into public.perfis (id, nome)
  values (
    new.id,
    -- cadastro por e-mail grava `nome`; o Google devolve `full_name`.
    nullif(
      coalesce(
        new.raw_user_meta_data ->> 'nome',
        new.raw_user_meta_data ->> 'full_name',
        ''
      ),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row
  execute function public.criar_perfil_para_novo_usuario();

-- Backfill: os usuarios criados antes deste trigger existir.
insert into public.perfis (id, nome)
select
  u.id,
  nullif(
    coalesce(u.raw_user_meta_data ->> 'nome', u.raw_user_meta_data ->> 'full_name', ''),
    ''
  )
from auth.users u
on conflict (id) do nothing;

-- A funcao e SECURITY DEFINER e vive no schema public, que o Supabase expoe
-- via REST: sem revogar, anon e authenticated poderiam chama-la por
-- /rest/v1/rpc/. Quem precisa executa-la e o trigger, que roda como owner.
-- Apontado pelo linter do Supabase (lints 0028 e 0029).
revoke execute on function public.criar_perfil_para_novo_usuario() from public;
revoke execute on function public.criar_perfil_para_novo_usuario() from anon;
revoke execute on function public.criar_perfil_para_novo_usuario() from authenticated;
