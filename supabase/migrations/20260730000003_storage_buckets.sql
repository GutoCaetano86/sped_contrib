-- Buckets privados e politica por prefixo de usuario. Ver docs/SPEC.md 3.3 e 8.
--
-- Os caminhos sao uploads/{user_id}/... e outputs/{user_id}/..., e a politica
-- compara a PRIMEIRA pasta do caminho com o auth.uid(). Sem isso qualquer
-- usuario autenticado leria o arquivo fiscal de qualquer outro apenas
-- adivinhando o caminho.

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false), ('outputs', 'outputs', false)
on conflict (id) do nothing;

-- storage.foldername(name) devolve as pastas do caminho; [1] e a primeira.
create policy "uploads_do_proprio_usuario" on storage.objects
  for all
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "outputs_do_proprio_usuario" on storage.objects
  for all
  using (
    bucket_id = 'outputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'outputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
