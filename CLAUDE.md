# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

SaaS que converte arquivos da **EFD-Contribuições** (TXT delimitado por `|`) em Excel editável e de volta em TXT válido para o PVA da Receita Federal.

Especificação completa em `docs/SPEC.md` (leia-a antes de implementar qualquer módulo — as seções relevantes são referenciadas abaixo). Roteiro de prompts prontos, na ordem de execução, em `docs/PROMPTS-CLAUDE-CODE.md`.

## Estado atual

`types.ts`, `layout.ts`, `parser.ts`, `serializer.ts` e `totalizers.ts` estão implementados. **`validator.ts`, `to-excel.ts` e `from-excel.ts` ainda são stubs `export {}`** com o contrato previsto em comentário.

- [x] Dicionário de leiaute (192 registros, 1.662 campos)
- [x] F1-T1 — scaffolding (Next 15, TS strict, Tailwind 4, shadcn/ui, Vitest)
- [x] F1-T2 — `types.ts` + `layout.ts` (loader com zod, índices O(1))
- [x] F1-T3 — dicionário fechado: 27 registros corrigidos, `revisao_manual` vazia, teste de integridade passando
- [x] F1-T4 — parser TXT → AST
- [x] F1-T5 — serializer + round-trip byte a byte
- [x] F1-T6 — totalizadores (round-trip byte a byte no arquivo real de 138.100 linhas)
- [ ] F1-T7 — validador
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

## Dicionário: estado e limites

**F1-T3 fechada.** 27 registros conferidos e corrigidos, `revisao_manual` vazia, 1.624 → 1.662 campos. O teste em `tests/sped/dicionario.test.ts` trava os critérios: numeração 1..N, campo 01 = `REG`, tipo `C`/`N`, nome único e no padrão do leiaute.

**Zero divergências** de contagem de campos contra os dois arquivos reais aprovados pelo PVA.

**O que o teste NÃO prova.** Ele é estrutural: mostra que o dicionário é coerente, não que descreve o leiaute certo. Os arquivos reais exercitam **74 dos 192** registros; os outros **118 nunca foram comparados com o guia** — são saída da extração que passa nos critérios. `dicionario.test.ts` tem um teste que fixa esse número em 118 para ele não passar despercebido; quando chegarem arquivos de outros perfis, deve baixar.

**A hierarquia de fontes, nesta ordem** (aprendida da pior forma no `M210`):

1. arquivo real aprovado pelo PVA;
2. transcrições do autor (`script.js` da Pagina-Converter-Sped, `EFDContrib.xlsm`);
3. Guia Prático v1.35 — **pode estar desatualizado**: dá 13 campos ao `M210`/`M610`, mas arquivo de dez/2021 aceito pelo PVA tem 16.

Uma divergência deliberada do texto da v1.35: o `C170` nomeia os campos 28 e 34 de `QUANT_BC` os dois, e adotamos `QUANT_BC_PIS`/`QUANT_BC_COFINS` das versões posteriores — senão a aba do Excel teria duas colunas com o mesmo cabeçalho e a volta para TXT, que mapeia por nome (spec §5.4), não saberia distinguir.

Ferramentas: `python scripts/conferencia/tabela_guia.py --acha REGISTRO` acha a página e `--borda`/`--posicional` leem a tabela; `node scripts/conferencia/compara_fontes.mjs` cruza com as transcrições do autor; `python scripts/conferencia/aplica_correcoes.py` é idempotente e registra cada correção com a página de origem.

### Detecção de defeito, para quando o dicionário for mexido de novo

`carregarLayout()` acumula os defeitos que encontra em `layout.avisosIntegridade`, com `motivo` tipado (`nome_duplicado`, `tipo_nao_identificado`, `num_nao_sequencial`, `campo_01_nao_e_reg`). Defeito é **aviso, não erro**: o produto roda com dicionário imperfeito.

Como o dicionário de verdade está limpo, quem exercita essa detecção é `tests/fixtures/layout_defeituoso.json` — um dicionário sintético com um defeito de cada tipo. Sem ele a detecção apodreceria sem ninguém notar.

Em nome repetido o índice por nome guarda a **primeira** ocorrência; a segunda só é alcançável por `campoPorNum`. Use `registro.campoPorNum` sempre que precisar de campo por número — a numeração está sequencial hoje, mas o índice não depende disso.

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
8. Os totalizadores `9900`, `9990`, `9999` e `X990` **sempre são recalculados** ao gerar o TXT — `9900` conta a si mesmo entre os tipos de registro, `9990` conta todas as linhas do bloco 9 incluindo ela mesma e a `9999`. A **ordem** em que o `9900` cita os registros não vem da spec: é convenção de quem gerou o arquivo (o real ordena por código dentro do bloco e deixa a entrada do próprio `9900` por último, depois da `9990` e da `9999`). `totalizers.ts` preserva a ordem que o arquivo declarou — sem isso o round-trip byte a byte é impossível em arquivo de terceiro.
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
