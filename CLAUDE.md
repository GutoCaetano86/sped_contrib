# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

SaaS que converte arquivos da **EFD-Contribuições** (TXT delimitado por `|`) em Excel editável e de volta em TXT válido para o PVA da Receita Federal.

Especificação completa em `docs/SPEC.md` (leia-a antes de implementar qualquer módulo — as seções relevantes são referenciadas abaixo). Roteiro de prompts prontos, na ordem de execução, em `docs/PROMPTS-CLAUDE-CODE.md`.

## Estado atual — leia isto antes de rodar qualquer comando

**Não existe código de aplicação ainda.** O repositório hoje só tem planejamento (`docs/SPEC.md`), o dicionário de leiaute (`data/`) e os scripts Python que o geraram (`scripts/`). Não há `package.json`, `app/`, `lib/` ou `tests/` — portanto **nenhum comando `npm run ...` funciona ainda**. Isso só muda a partir da tarefa F1-T1 (scaffolding do Next.js), descrita em `docs/PROMPTS-CLAUDE-CODE.md`.

- [x] Dicionário de leiaute extraído do guia oficial (192 registros, 1.624 campos)
- [ ] Conferir os 19 registros listados em `revisao_manual` do JSON (tarefa F1-T3)
- [ ] Fase 1 — núcleo do parser (`lib/sped/`, sem interface)
- [ ] Fase 2 — conversão Excel
- [ ] Fase 3 — SaaS (Supabase, auth, rotas, UI)

Antes de propor scaffolding, confira `docs/PROMPTS-CLAUDE-CODE.md` na tarefa correspondente à etapa em que o projeto está — os critérios de aceite de cada tarefa são a definição de "pronto" deste projeto, não julgamento próprio.

## Comandos que funcionam hoje

Regenerar o dicionário de leiaute (só necessário quando a Receita publicar nova versão do Guia Prático):

```bash
pip install pdfplumber
cd scripts
python dump_pages.py ../docs/Guia-Pratico-EFD-Contribuicoes-v1.35.pdf 60 433 chunks/c1.json
python dump_words.py ../docs/Guia-Pratico-EFD-Contribuicoes-v1.35.pdf 60 433 words/w1.json
python build_layout.py
```

Em máquinas mais lentas, quebre os intervalos de página em blocos de ~70 páginas (múltiplas chamadas de `dump_pages.py`/`dump_words.py` com `chunks/c2.json`, `words/w2.json` etc.; `build_layout.py` lê todos os `chunks/*.json` e `words/*.json` de uma vez via `glob`).

## Comandos previstos (a partir de F1-T1 — ainda não existem)

```bash
npm run dev              # desenvolvimento
npm run test             # Vitest
npm run test:watch
npm run typecheck        # tsc --noEmit
npm run lint
npm run convert -- <arquivo>   # CLI interna de conversão (a partir de F2-T4)
npm run build
```

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind + shadcn/ui · Supabase (Auth + Postgres + Storage) · exceljs · Vitest · Deploy na Vercel.

## Arquitetura (estrutura-alvo, spec seção 3.2)

```
app/
├── (marketing)/page.tsx           # landing
├── (auth)/login/page.tsx
├── (app)/{dashboard,upload,arquivo/[id]}/page.tsx
└── api/{upload,convert,download/[id],files}/route.ts
lib/
├── sped/           # núcleo puro — ver "Decisão de arquitetura" abaixo
│   ├── types.ts          # CampoLayout, RegistroLayout, NoRegistro, ResultadoParse...
│   ├── layout.ts         # carrega e valida data/layout_efd_contribuicoes.json (zod)
│   ├── parser.ts         # TXT      → AST (árvore de NoRegistro)
│   ├── validator.ts      # AST      → erros[] / avisos[] (não lança, não bloqueia leitura)
│   ├── to-excel.ts       # AST      → XLSX (streaming, uma aba por registro)
│   ├── from-excel.ts     # XLSX     → AST (mapeamento de coluna POR NOME, não posição)
│   ├── totalizers.ts     # AST      → AST com 9900/9990/9999/X990 recalculados
│   └── serializer.ts     # AST      → TXT (Latin-1, CRLF, sem linha em branco)
├── supabase/{client,server,admin}.ts
└── plans.ts        # limites por plano (free/pro/escritorio), ver spec 4.1
data/layout_efd_contribuicoes.json
supabase/migrations/  # tabelas perfis, arquivos, conversoes — todas com RLS por user_id
```

**Decisão de arquitetura registrada (spec §3.1):** `lib/sped/` é TypeScript puro — sem import de React, Next ou Supabase — para rodar isolado no Vitest e permitir extração futura para pacote npm ou Edge Function.

**Pipeline TXT → XLSX** (spec §3.3): upload valida extensão/tamanho/`|0000|` inicial → `parser.ts` monta a AST resolvendo hierarquia por pilha de níveis → `validator.ts` anota erros/avisos sem bloquear → `to-excel.ts` gera o XLSX (streaming `WorkbookWriter`, células de dados sempre `numFmt: '@'` para não corromper zeros à esquerda) → grava em `outputs/{user_id}/`.

**Pipeline XLSX → TXT** (spec §3.4): `from-excel.ts` lê a aba `_META` (contrato de reconversão — se `layout`/`versao_guia` divergir, recusa) → reconstrói AST por `_ordem`/`_id`/`_pai` → `validator.ts` aqui **bloqueia** em erro → `totalizers.ts` recalcula `X990`/`9900`/`9990`/`9999` → `serializer.ts` gera o TXT final.

Note a assimetria: erros **não bloqueiam** TXT→XLSX (o usuário quer ver e corrigir na planilha) mas **bloqueiam** XLSX→TXT (gerar um arquivo que o PVA rejeita é pior que não gerar) — decisão registrada na spec §11.

O teste de aceite mais importante do projeto (spec §9.2) é o round-trip completo: `parseTxt → gerarExcel → lerExcel → recalcularTotalizadores → serializarTxt` deve devolver o arquivo original byte a byte quando não houve edição.

## Regras invioláveis do domínio

Errar qualquer uma destas gera arquivo rejeitado pelo PVA:

1. **Encoding ISO-8859-1 (Latin-1)**, nunca UTF-8.
2. **Quebra de linha CRLF** (`\r\n`).
3. Toda linha **começa e termina com `|`**. Os pipes das pontas são delimitadores, não conteúdo.
4. **Nenhuma linha em branco** no arquivo.
5. **Separador decimal é vírgula**, sem separador de milhar.
6. Datas em `ddmmaaaa`, períodos em `mmaaaa`, horas em `hhmmss`.
7. **Zeros à esquerda são significativos** (CNPJ, CPF, códigos). Nunca normalizar números.
8. Os totalizadores `9900`, `9990`, `9999` e `X990` **sempre são recalculados** ao gerar o TXT — `9900` conta a si mesmo entre os tipos de registro, `9990` conta todas as linhas do bloco 9 incluindo ela mesma e a `9999`.
9. A ordem dos blocos é fixa: `0 → A → C → D → F → I → M → P → 1 → 9`.
10. Registro filho exige registro pai imediatamente acima na sequência.

## Convenções de código

- Código, comentários, mensagens de erro e commits em **português (pt-BR)**.
- Nomes de variáveis e funções em português quando representam conceito do domínio (`recalcularTotalizadores`, `nos`, `valores`); termos técnicos consagrados ficam em inglês (`parser`, `buffer`, `stream`).
- `lib/sped/` é **puro TypeScript**: sem import de React, Next ou Supabase. Deve rodar em Node isolado.
- Parser **nunca lança exceção** por conteúdo inválido do usuário — acumula em `erros[]` / `avisos[]` e prossegue.
- Toda função exportada de `lib/sped/` tem teste unitário.
- Sem `any`. Tipos em `lib/sped/types.ts`.
- Formatação: Prettier padrão, 2 espaços, aspas simples.

## Onde encontrar o quê

| Preciso de... | Vá para |
| --- | --- |
| Contrato de função, algoritmo, casos de borda de um módulo de `lib/sped/` | `docs/SPEC.md` seção 5 (5.1 tipos, 5.2 parser, 5.3 to-excel, 5.4 from-excel, 5.5 totalizers, 5.6 serializer, 5.7 validator) |
| Schema do banco, RLS, limites de plano | `docs/SPEC.md` seção 4 |
| Contrato das rotas de API | `docs/SPEC.md` seção 6 |
| Estados de UI exigidos | `docs/SPEC.md` seção 7.5 |
| Próximo prompt de desenvolvimento a executar | `docs/PROMPTS-CLAUDE-CODE.md`, na ordem F1-T1 → F3-T6 |
| Por que uma decisão foi tomada (e a alternativa descartada) | `docs/SPEC.md` seção 11 |
| Os 19 registros do dicionário com extração incompleta | array `revisao_manual` em `data/layout_efd_contribuicoes.json` |

## Ao trabalhar neste projeto

- Antes de implementar qualquer módulo de `lib/sped/`, leia a seção correspondente da `docs/SPEC.md` (seção 5) — os contratos de função e algoritmos já estão especificados, não reinvente.
- Escreva o teste antes da implementação em `totalizers.ts` — é o módulo mais propenso a bug do projeto.
- O critério de aceite final não é o teste unitário: é o TXT reconvertido passar no PVA oficial da Receita Federal.
- Nunca registrar conteúdo de arquivo fiscal em log. Apenas `arquivo_id`, contagens e duração.
