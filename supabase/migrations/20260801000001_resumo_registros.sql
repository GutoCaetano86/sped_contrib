-- Resumo de registros por tipo, para a tabela de conferencia da tela de
-- detalhe (spec 7.4: "registros por tipo com contagem").
--
-- Guardado na conversao em vez de recalculado: reparsear um TXT de 17 MB a
-- cada visita da pagina custaria meio segundo de CPU e um download do Storage,
-- para um dado que nao muda depois que a conversao termina.
--
-- Formato: [{"reg": "C170", "n": 34758}, ...] ordenado por codigo.
alter table public.conversoes
  add column if not exists resumo_registros jsonb not null default '[]'::jsonb;

comment on column public.conversoes.resumo_registros is
  'Contagem por tipo de registro: [{"reg","n"}], para a tela de detalhe.';
