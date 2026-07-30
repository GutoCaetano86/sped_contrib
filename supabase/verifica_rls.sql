-- Criterio de aceite de F3-T1: provar que um usuario nao le arquivo de outro.
--
-- Roda contra o banco e LANCA EXCECAO na primeira falha, entao serve como
-- teste: se terminar sem erro, o isolamento esta valendo.
--
-- Nao esta no Vitest de proposito. A suite de testes e pura e offline; um
-- teste de RLS precisa de banco e de dois usuarios reais, o que a tornaria
-- dependente de rede e de credencial.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f supabase/verifica_rls.sql
-- ou cole no SQL Editor do painel do Supabase.
--
-- Exige pelo menos dois usuarios em auth.users. Cria e apaga suas proprias
-- linhas de teste; nao mexe em dado existente.

do $$
declare
  a uuid;
  b uuid;
  arq_a uuid;
  arq_b uuid;
  visiveis int;
  afetadas int;
  bloqueou boolean;
begin
  select id into a from auth.users order by created_at limit 1;
  select id into b from auth.users where id <> a order by created_at limit 1;
  if a is null or b is null then
    raise exception 'Precisa de dois usuarios em auth.users para verificar o isolamento.';
  end if;

  -- Setup como owner das tabelas, que passa por cima da RLS.
  insert into public.arquivos (user_id, nome_original, tipo, tamanho_bytes, storage_path)
  values (a, '_rls_a.txt', 'txt', 1, 'uploads/' || a || '/_rls_a.txt') returning id into arq_a;
  insert into public.arquivos (user_id, nome_original, tipo, tamanho_bytes, storage_path)
  values (b, '_rls_b.txt', 'txt', 1, 'uploads/' || b || '/_rls_b.txt') returning id into arq_b;

  -- ---------------------------------------------------------------- leitura
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select count(*) into visiveis from public.arquivos;
  if visiveis <> 1 then
    raise exception 'A deveria ver 1 arquivo, viu %', visiveis;
  end if;

  select count(*) into visiveis from public.arquivos where id = arq_b;
  if visiveis <> 0 then
    raise exception 'A leu o arquivo de B pelo id exato';
  end if;

  select count(*) into visiveis from public.perfis;
  if visiveis <> 1 then
    raise exception 'A deveria ver 1 perfil, viu %', visiveis;
  end if;

  -- ---------------------------------------------------------------- escrita
  update public.arquivos set razao_social = 'INVADIDO' where id = arq_b;
  get diagnostics afetadas = row_count;
  if afetadas <> 0 then
    raise exception 'A alterou % linha(s) de B', afetadas;
  end if;

  delete from public.arquivos where id = arq_b;
  get diagnostics afetadas = row_count;
  if afetadas <> 0 then
    raise exception 'A apagou % linha(s) de B', afetadas;
  end if;

  -- Plantar linha em nome de outro tem de estourar no `with check`.
  bloqueou := false;
  begin
    insert into public.arquivos (user_id, nome_original, tipo, tamanho_bytes, storage_path)
    values (b, '_plantado.txt', 'txt', 1, 'x');
  exception when insufficient_privilege then
    bloqueou := true;
  end;
  if not bloqueou then
    raise exception 'A conseguiu inserir arquivo em nome de B';
  end if;

  -- ------------------------------------------------------- o mesmo para B
  perform set_config('request.jwt.claims',
                     json_build_object('sub', b, 'role', 'authenticated')::text, true);

  select count(*) into visiveis from public.arquivos;
  if visiveis <> 1 then
    raise exception 'B deveria ver 1 arquivo, viu %', visiveis;
  end if;
  select count(*) into visiveis from public.arquivos where id = arq_a;
  if visiveis <> 0 then
    raise exception 'B leu o arquivo de A pelo id exato';
  end if;

  -- ------------------------------------------------------------ sem sessao
  perform set_config('request.jwt.claims', null, true);
  select count(*) into visiveis from public.arquivos;
  if visiveis <> 0 then
    raise exception 'Anonimo viu % arquivo(s)', visiveis;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.arquivos where id in (arq_a, arq_b);

  raise notice 'OK: isolamento por RLS conferido em leitura, escrita e acesso anonimo.';
end $$;
