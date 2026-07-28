# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

SaaS que converte arquivos da **EFD-Contribuições** (TXT delimitado por `|`) em Excel editável e de volta em TXT válido para o PVA da Receita Federal.

Especificação completa em `docs/SPEC.md` (leia-a antes de implementar qualquer módulo — as seções relevantes são referenciadas abaixo). Roteiro de prompts prontos, na ordem de execução, em `docs/PROMPTS-CLAUDE-CODE.md`.

## Estado atual

`types.ts` e `layout.ts` estão implementados. **Os demais módulos de `lib/sped/` ainda são stubs `export {}`** com o contrato previsto em comentário.

- [x] Dicionário de leiaute extraído do guia oficial (192 registros, 1.624 campos)
- [x] F1-T1 — scaffolding (Next 15, TS strict, Tailwind 4, shadcn/ui, Vitest)
- [x] F1-T2 — `types.ts` + `layout.ts` (loader com zod, índices O(1))
- [ ] F1-T3 — fechar o dicionário: os 21 de `revisao_manual` **mais** os defeitos abaixo
- [ ] F1-T4 a F1-T7 — parser, serializer, totalizers, validator
- [ ] Fase 2 — conversão Excel
- [ ] Fase 3 — SaaS (Supabase, auth, rotas, UI)

Antes de propor trabalho novo, confira em `docs/PROMPTS-CLAUDE-CODE.md` a tarefa correspondente à etapa em que o projeto está — os critérios de aceite de cada tarefa são a definição de "pronto" deste projeto, não julgamento próprio.

## Comandos

```bash
npm run dev              # desenvolvimento (localhost:3000)
npm run test             # Vitest — testes em tests/**/*.test.ts
npm run test:watch
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run build
npm run convert -- <arquivo>   # CLI interna de conversão (stub até F2-T4)
```

Regenerar o dicionário de leiaute (só necessário quando a Receita publicar nova versão do Guia Prático):

```bash
pip install pdfplumber
cd scripts
python dump_pages.py ../docs/Guia-Pratico-EFD-Contribuicoes-v1.35.pdf 60 433 chunks/c1.json
python dump_words.py ../docs/Guia-Pratico-EFD-Contribuicoes-v1.35.pdf 60 433 words/w1.json
python build_layout.py
```

Em máquinas mais lentas, quebre os intervalos de página em blocos de ~70 páginas (múltiplas chamadas de `dump_pages.py`/`dump_words.py` com `chunks/c2.json`, `words/w2.json` etc.; `build_layout.py` lê todos os `chunks/*.json` e `words/*.json` de uma vez via `glob`).

## Dicionário: o que já foi corrigido e o que falta

**Corrigidos e validados contra arquivo aprovado pelo PVA** (F1-T3, parte 1) — os 8 registros em que a contagem de campos do dicionário divergia de arquivo real: `0111` (6, era 4), `0500` (9, era 8), `1100` (18, era 8), `9990` (2, era 3), `C500` (15, era 14), `D100` (23, era 22), `M110` (7, era 6), `M500` (15, era 14). Total de campos foi de 1.624 para 1.640. Hoje **zero divergências** contra os arquivos reais disponíveis.

Cobertura empírica: os arquivos reais exercitam 74 dos 192 registros. Os outros **118 nunca aparecem** e só podem ser conferidos contra o guia.

**Ainda quebrados** — os 15 restantes da `revisao_manual`: `C396`, `C810`, `C820`, `C880`, `D201`, `F500`, `F510`, `F550`, `F560`, `M220`, `P100`, `1300`, `1500`, `1620`, `1700`. Reprovam nos critérios de integridade (numeração com buraco, campo 01 ≠ `REG`, tipo não identificado). **O teste de integridade de F1-T3 só passa quando estes forem fechados.**

Ferramentas: `python scripts/conferencia/tabela_guia.py --acha REGISTRO` acha a página, `node scripts/conferencia/compara_fontes.mjs` cruza com as transcrições antigas do autor.

## Defeitos de NOME do dicionário (achados em F1-T2)

A spec §2.4 afirma que os 171 registros fora da `revisao_manual` foram validados por três critérios (numeração sequencial, campo 01 = `REG`, tipo `C`/`N`). **Unicidade e integridade do nome do campo não estavam entre eles** — e é justamente o nome que serve de chave do índice O(1) e, na Fase 2, de cabeçalho de coluna no Excel. F1-T3 precisa cobrir também:

| Registro | Defeito | Nome correto provável |
| --- | --- | --- |
| `0000` #13 | `IND_NAT_PJSCPSCPSCP` — texto vizinho da tabela grudou no nome | `IND_NAT_PJ` |
| `C170` #28 / #34 | ambos `QUANT_BC`; só a descrição distingue (PIS / COFINS) | `QUANT_BC_PIS` / `QUANT_BC_COFINS` |
| `M210` #11/#14/#15, #13/#16 | `VL_CONT_DIFER` ×3 e `VL_CONT_PER` ×2 | conferir na página do guia |
| `M610` | idêntico ao `M210` | idem |
| `0145` #3 / #4 | ambos `VL_REC` | conferir |

`carregarLayout()` não esconde nada disso: expõe tudo em `layout.avisosIntegridade`, com `motivo` tipado (`nome_duplicado`, `tipo_nao_identificado`, `num_nao_sequencial`, `campo_01_nao_e_reg`). Em nome duplicado o índice guarda a **primeira** ocorrência e a segunda fica inacessível por nome — daí o aviso. Os testes em `tests/sped/layout.test.ts` fixam o conjunto atual de defeitos, então **eles vão falhar quando F1-T3 corrigir o dicionário — isso é intencional**, é o sinal de que a correção surtiu efeito; atualize as expectativas junto.

Cuidado relacionado: em 19 registros a numeração dos campos tem buracos, então `campos[num - 1]` devolve o campo errado. Use `registro.campoPorNum`.

## Particularidades do ambiente (custaram tempo, não redescubra)

- O **TypeScript é 6.x**, mais novo que o assumido pelo `create-next-app`. Duas consequências já tratadas: `baseUrl` está deprecado (usamos só `paths`), e imports de efeito colateral de `.css` exigem declaração — daí `types/estilos.d.ts`, já que o Next só declara `*.module.css`.
- `next-env.d.ts` fica **versionado de propósito**: sem ele, `npm run typecheck` falha em clone novo enquanto o Next não rodar pela primeira vez.
- `eslint-config-next` fica **pinado no major do `next`**. A linha 16 usa flat config nativo e quebra o `FlatCompat` do `eslint.config.mjs` com erro obscuro (`Converting circular structure to JSON`).
- Existe um `package-lock.json` solto em `C:\Users\augus\`; por isso o `outputFileTracingRoot` explícito no `next.config.ts` — sem ele o Next infere a home do usuário como raiz do workspace.
- `npm audit` acusa vulnerabilidades altas em `postcss` e `sharp`, ambas transitivas dentro do próprio `next`. O `fix` sugerido regride o Next para a 9.3.3 — **não rodar `npm audit fix --force`**.

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
