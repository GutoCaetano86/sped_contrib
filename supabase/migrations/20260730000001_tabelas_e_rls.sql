-- Tabelas, indices e RLS. Ver docs/SPEC.md secao 4.
--
-- Arquivo de EFD-Contribuicoes carrega CNPJ, faturamento, base de calculo e
-- participantes. A RLS aqui e o que garante que um usuario nao leia dado
-- fiscal de outro (spec 8) — nao ha camada de aplicacao substituindo isso.

-- perfis: espelha auth.users
create table public.perfis (
  id         uuid primary key references auth.users on delete cascade,
  nome       text,
  empresa    text,
  plano      text not null default 'free'
               check (plano in ('free', 'pro', 'escritorio')),
  criado_em  timestamptz not null default now()
);

-- arquivos enviados
create table public.arquivos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  nome_original  text not null,
  tipo           text not null check (tipo in ('txt', 'xlsx')),
  tamanho_bytes  bigint not null,
  storage_path   text not null,
  hash_sha256    text,
  -- metadados extraidos do registro 0000
  cnpj           text,
  razao_social   text,
  periodo_inicio date,
  periodo_fim    date,
  criado_em      timestamptz not null default now()
);

-- conversoes
create table public.conversoes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  arquivo_origem_id uuid not null references public.arquivos on delete cascade,
  arquivo_saida_id  uuid references public.arquivos on delete set null,
  direcao           text not null
                      check (direcao in ('txt_para_xlsx', 'xlsx_para_txt')),
  status            text not null default 'pendente'
                      check (status in ('pendente', 'processando', 'concluido', 'erro')),
  total_linhas      integer,
  total_registros   integer,
  erros             jsonb default '[]'::jsonb,
  avisos            jsonb default '[]'::jsonb,
  duracao_ms        integer,
  criado_em         timestamptz not null default now(),
  concluido_em      timestamptz
);

-- O dashboard lista por usuario, mais recente primeiro (spec 7.2).
create index arquivos_user_criado_idx   on public.arquivos   (user_id, criado_em desc);
create index conversoes_user_criado_idx on public.conversoes (user_id, criado_em desc);
-- A pagina de detalhe busca as conversoes de um arquivo.
create index conversoes_origem_idx      on public.conversoes (arquivo_origem_id);

alter table public.perfis     enable row level security;
alter table public.arquivos   enable row level security;
alter table public.conversoes enable row level security;

-- `for all` com apenas `using`: o Postgres reaproveita a expressao como
-- `with check` no insert e no update, entao a politica cobre leitura e
-- escrita. Fica explicito abaixo para nao depender desse comportamento.
create policy "proprio_perfil" on public.perfis
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "proprios_arquivos" on public.arquivos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "proprias_conversoes" on public.conversoes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
