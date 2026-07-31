# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

SaaS que converte arquivos da **EFD-Contribuições** (TXT delimitado por `|`) em Excel editável e de volta em TXT válido para o PVA da Receita Federal.

Especificação completa em `docs/SPEC.md` (leia-a antes de implementar qualquer módulo — as seções relevantes são referenciadas abaixo). Roteiro de prompts prontos, na ordem de execução, em `docs/PROMPTS-CLAUDE-CODE.md`.

## Estado atual

**Fases 1 e 2 completas.** Nenhum stub restante em `lib/sped/`. A Fase 3 tem F3-T1 e F3-T2 prontas.

- [x] Dicionário de leiaute (192 registros, 1.662 campos)
- [x] F1-T1 — scaffolding (Next 15, TS strict, Tailwind 4, shadcn/ui, Vitest)
- [x] F1-T2 — `types.ts` + `layout.ts` (loader com zod, índices O(1))
- [x] F1-T3 — dicionário fechado: 27 registros corrigidos, `revisao_manual` vazia, teste de integridade passando
- [x] F1-T4 — parser TXT → AST
- [x] F1-T5 — serializer + round-trip byte a byte
- [x] F1-T6 — totalizadores (round-trip byte a byte no arquivo real de 138.100 linhas)
- [x] F1-T7 — validador (tabela 5.7 completa, CNPJ alfanumérico)
- [x] F2-T1 — `to-excel.ts` (streaming, células como texto, colunas de contexto do pai)
- [x] F2-T2 — `from-excel.ts` (mapeamento por nome, 6 casos de borda)
- [x] F2-T3 — **teste de ouro**: round-trip completo byte a byte em 138.100 linhas
- [x] F2-T4 — CLI `npm run convert`
- [x] F3-T1 — banco, RLS, buckets, trigger de perfil, `plans.ts`
- [x] F3-T2 — auth: e-mail/senha e Google, verificados por evidência de servidor
- [x] F3-T3 — rotas de API (`upload`, `convert`, `download/[id]`, `files`), 44 testes
- [ ] F3-T4 a F3-T7 — UI, landing, deploy

**O PVA aceitou o arquivo reconvertido** (30/07/2026): "A importação foi concluída com êxito. A escrituração não possui erros de estrutura." O teste foi feito com edição de verdade — 5 dos 10 itens de um `C170` excluídos —, então exercitou o recálculo de `9900`/`C990`/`9990`/`9999` fora do caso de round-trip idêntico. É o critério de aceite da spec §9.4, o único que os testes daqui não substituem.

Antes de propor trabalho novo, confira em `docs/PROMPTS-CLAUDE-CODE.md` a tarefa correspondente à etapa em que o projeto está — os critérios de aceite de cada tarefa são a definição de "pronto" deste projeto, não julgamento próprio.

## Comandos

```bash
npm run dev              # desenvolvimento (localhost:3000)
npm run test             # Vitest — testes em tests/**/*.test.ts
npm run test:watch
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run build
npm run convert -- entrada.txt --saida saida.xlsx   # e o inverso; --ajuda lista as opções
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

**O melhor auditor do dicionário é o validador, não o teste de integridade.** Rodar `validar()` contra arquivo aprovado pelo PVA achou 6 defeitos que os critérios estruturais não pegam — tamanho e tipo errados, e nome vazado de registro vizinho (`A010`/`D010` estavam com o `IND_MOV` do `A001`/`D001`). Ao receber arquivo real novo, rode o validador contra ele antes de qualquer outra coisa: **erro bloqueante em arquivo que o PVA aceitou é defeito do dicionário, não do arquivo.**

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

## O teste de ouro é o que segura a Fase 2

`tests/sped/ouro.test.ts` roda o ciclo inteiro — `parseTxt → gerarExcel → lerExcel → recalcularTotalizadores → serializarTxt` — e exige o arquivo original **byte a byte**. É o único teste que exercita os cinco módulos juntos, e a spec §9.2 o chama de mais importante do projeto. Ele passa nas 138.100 linhas do arquivo real (o caso grande se pula sozinho quando o arquivo de 17 MB não está na máquina).

Se ele quebrar depois de uma mudança, o defeito está em totalizadores, ordenação ou encoding — nessa ordem de probabilidade.

Dois caminhos de corrupção que o `from-excel.ts` trata e que valem conhecer, porque o Excel os cria silenciosamente: número onde havia texto com zero à esquerda (vira aviso quando o campo é `tamanho_fixo`), e **data digitada volta como número de série do Excel** — 44197 em vez de `01012021`. O segundo não tem como ser detectado sem saber que o campo é data, e por isso o `from-excel` usa a mesma convenção do validador (prefixo `DT_` com 8 posições).

## Colunas de contexto do pai (a aba do filho tem de se explicar sozinha)

Pedido do usuário, e não é cosmético: aberta a aba `C170`, não havia como saber a qual nota fiscal cada item pertence — o vínculo existia só na coluna `_pai`, que é id opaco e oculto. A macro VBA do próprio autor resolvia isso repetindo `CNPJ`, `Item Pai`, `NUM_DOC` e `COD_PART` nas primeiras colunas, e é a mesma ideia aqui.

`to-excel.ts` insere, entre `_ordem` e `REG`, a coluna `_item_pai` (número da instância do registro pai) e até quatro campos identificadores de cada ancestral, tirados de `CAMPOS_DE_CONTEXTO`. Na `C170` do arquivo real saem `_item_pai _C010_CNPJ _C100_NUM_DOC _C100_COD_PART _C100_SER _C100_DT_DOC`.

**O nome levar o registro de origem não é enfeite — é o que evita dois defeitos.** `CNPJ` aparece como campo de verdade em 17 registros, `NUM_DOC` em 17, `COD_MOD` em 24: uma coluna chamada só `CNPJ` na aba do `C170` daria cabeçalho duplicado e o `from-excel`, que mapeia **por nome** (spec §5.4), erraria o campo — a mesma classe de problema do `QUANT_BC` duplicado do `C170`. E o prefixo `_` é o que faz o `from-excel` ignorar essas colunas sem precisar de uma linha de código lá: nenhum campo do leiaute começa com sublinhado.

Duas decisões que evitam ruído: ancestral de nível 0 (o `0000`) é pulado, porque o CNPJ dele é o mesmo em todas as 138.100 linhas; e a aba só ganha as derivadas quando há contexto útil — `C001`, cujo pai é o `0000`, e `M210`, cujo pai `M200` não tem campo identificador, não ganham nenhuma.

As derivadas saem travadas, com cabeçalho em verde e comentário dizendo de onde o valor vem. **Editar ali não altera o TXT** — a correção tem de ser feita no registro de origem.

## Desempenho medido

`gerarExcel` no arquivo real de 138.100 linhas / 17 MB: **24,3 MB de XLSX em 35,6 s**, heap de 335 MB. As colunas de contexto custaram +22% de tamanho e +27% de tempo sobre a medição original de F2-T1 (19,9 MB em 28 s, heap 148 MB) — o preço da usabilidade que o usuário pediu.

**A meta da spec §1.4 (50 MB em menos de 30 s) não é atendida por este caminho.** A taxa medida é ~0,5 MB/s de TXT, o que põe um arquivo de 50 MB em torno de 105 s — e isso só na geração do Excel, sem contar upload, parse e storage. Antes de fechar a Fase 3 é preciso decidir: aceitar o tempo maior, mover acima de 20 MB para Edge Function (como a spec §3.1 já prevê), ou otimizar. O gargalo provável é o `numFmt` por célula; vale medir com estilo só na coluna antes de otimizar às cegas.

## Banco e segurança (F3-T1)

Três migrations em `supabase/migrations/`, aplicadas no projeto `xqhebqvnjwspmvrhmqsz`: tabelas `perfis`/`arquivos`/`conversoes` com índices, RLS por `user_id` nas três, trigger `ao_criar_usuario` criando o perfil, e os buckets privados `uploads`/`outputs` com política por prefixo `{user_id}/`.

**A RLS é a única camada de isolamento** — não há verificação equivalente na aplicação. O critério de aceite é reprodutível: `supabase/verifica_rls.sql` lança exceção na primeira falha e cobre leitura, escrita (update, delete, insert em nome de outro) e acesso anônimo. Rode-o depois de qualquer mexida em política ou tabela.

Ele **não** está no Vitest de propósito: a suíte é pura e offline, e um teste de RLS exige banco e dois usuários reais.

**Rode `get_advisors` do Supabase depois de mudar schema.** Ele pegou um defeito que eu introduzi: a função do trigger é `SECURITY DEFINER` no schema `public`, que o Supabase expõe via REST, então `anon` podia chamá-la por `/rest/v1/rpc/`. A correção é `revoke execute`, já na migration.

Pendência de projeto, não de código: **Leaked Password Protection está desligada** no painel (Authentication → Policies). Ela confere a senha contra o HaveIBeenPwned.

**`SUPABASE_SERVICE_ROLE_KEY` está vazia no `.env.local`.** Nada em produção depende dela hoje — as rotas de API usam `criarClienteServidor()`, que respeita a RLS —, mas `criarClienteAdmin()` lança na primeira chamada. Preencher antes do job de retenção (spec §8), que é o primeiro caso de uso previsto. Está em Project Settings → API Keys → service_role.

## Base de crédito: o que apagar um item de `C170` quebra

**O caso que originou o módulo.** Em 30/07/2026 o usuário apagou 5 itens de um `C170` e 4 de um `A170` na planilha. Os totalizadores de linha foram recalculados, o arquivo saiu, e **o PVA recusou com 14 erros** — 12 deles em `M105.VL_BC_PIS_TOT` / `M505.VL_BC_COFINS_TOT`. O PVA recalcula a base de cálculo do crédito somando os documentos e compara com o declarado.

**Os deltas batem exatamente**: os 5 `C170` somavam R$ 6.682,59 de `VL_BC_PIS` e o PVA cobrou exatamente 6.682,59 no NAT 02; os 4 `A170` somavam 544,31 e ele cobrou 544,31 no NAT 03. A regra é linear e mecânica.

**O problema é que o `C170` não tem campo `NAT_BC_CRED`.** Só `A170`, `C501`, `D101`, `F100`, `F120` e `F130` declaram. Para o bloco C a natureza do crédito vem da classificação fiscal do item, que o CFOP sugere mas não determina — dois itens com o mesmo CFOP podem ter naturezas diferentes conforme a destinação. Uma tabela CFOP→NAT geral assumiria a premissa de um contribuinte para todos, e o erro sairia **aceito pelo PVA e errado no crédito**, que é pior que ser recusado.

**A saída foi aprender a atribuição do próprio arquivo** (decisão do usuário entre quatro opções). O TXT de origem foi aceito pelo PVA, então seus `M105` são verdade: dá para descobrir qual grupo de CFOP alimenta cada NAT resolvendo o sistema, e só aceitar quando fecha **exato**. No arquivo real fecha com diferença 0,00 nos dois tributos, e o mapa que sai é fiscalmente coerente — `1102`/`2102` → 01 revenda, `1101`/`2101`/`1556` → 02 insumo, `1124`/`1125` → 03 industrialização, `2201` → 12 devolução.

O mapa vai para a `_META` na ida e é usado na volta. Verificado: aplicado ao arquivo que o PVA recusou, produz **os 12 valores exatos que ele cobrou**.

### Três estados, com tratamento oposto — não os confunda

| Estado na `_META` | Significado | O que a volta faz |
| --- | --- | --- |
| chave `atribuicao_credito` **ausente** | planilha de versão antiga | compara só o total geral; se mudou, **bloqueia** |
| presente, tributo **em** `fechou` | base fechava na origem | recalcula balde a balde |
| presente, tributo **fora** de `fechou` | base já não fechava | **não mexe** e avisa |

O terceiro caso custou um bug: sem ele eu zerava o `M105` de arquivos cuja base nunca fechou (como a fixture `efd_reduzido.txt`, que tem valores embaralhados pelo anonimizador). Por isso o mapa é gravado **sempre**, mesmo vazio — a ausência da chave tem de significar outra coisa.

### A cadeia inteira, e ela custou TRÊS rodadas no PVA

O PVA valida cada elo separadamente, e corrigir um só faz ele apontar o próximo. A ordem em que apareceram:

| Rodada | O que ele cobrou |
| --- | --- |
| 1ª | **campo 4** (`VL_BC_*_TOT`) = soma dos documentos daquele NAT |
| 2ª | **campo 6** (`VL_BC_*_NC`) = campo 4 − campo 5 (`..._CUM`) |
| 3ª | **Σ campo 7** do grupo (mesmo CST, natureza, alíquota e tipo de crédito) = campo 6 |

Daí para baixo é aritmética, tudo medido 9/9 no arquivo aprovado:

```
M100.VL_BC        = soma dos campos 7 dos filhos
M100.VL_CRED      = VL_BC × alíquota
VL_CRED_DISP      = VL_CRED + acréscimos − reduções − diferido
IND_DESC_CRED = 0 → VL_CRED_DESC = DISP e SLD_CRED = 0
IND_DESC_CRED = 1 → VL_CRED_DESC fica como está e SLD_CRED = DISP − DESC
M200.VL_TOT_CRED_DESC   = Σ M100.VL_CRED_DESC
M200.VL_TOT_CONT_NC_DEV = contribuição − crédito descontado − crédito anterior
```

O rateio do campo 7 vem do `0111` (15,974950% / 82,261940% / 1,763110% no arquivo real) e é preservado por proporção, com o resíduo do arredondamento na maior parcela.

**A cascata altera o valor a recolher** — no arquivo real, de 0,00 para 21,15 de PIS. É o efeito correto de remover um item de documento, mas o aviso diz isso em letras garrafais e o usuário tem de conferir.

### Duas armadilhas que quebraram o round-trip

1. **A reconciliação do campo 7 tem de ser incondicional**, não só quando o campo 4 muda. Um arquivo pode chegar com o total já corrigido e o rateio velho — foi exatamente o caso na terceira rodada, e por isso a correção não rodou.
2. **Tolerância de 1 centavo por parcela.** O arquivo aprovado tem 4 grupos por tributo em que Σ campo 7 difere do campo 6 por exatamente 0,01 — cada parcela é arredondada em separado e o PVA aceita. Sem a folga, o recálculo "conserta" esses centavos e o teste de ouro morre em arquivo que ninguém editou.

### O que NÃO é recalculado, de propósito

`VL_CRED_DESC` quando `IND_DESC_CRED = 1` (desconto parcial): quanto do crédito usar é decisão do contribuinte. Fora isso a cadeia é completa.

Relações medidas e ainda não usadas: `M200`/`M600` = Σ `M210`/`M610.VL_CONT_APUR`; `M400`/`M800` = Σ `M410`/`M810.VL_REC`.

### Limites conhecidos

- **A solução do sistema é a primeira que fecha; não provamos unicidade** — a busca exaustiva estourou 900 s. Se dois grupos de CFOP fossem trocáveis, o delta cairia no NAT errado, e o PVA acusaria **os dois** baldes, porque valida exatamente essa relação. O erro aparece na validação, não passa silencioso.
- `FONTES` em `apuracao.ts` lista os registros que alimentam a base. Se um perfil usar outro, a soma não fecha e o aprendizado é recusado — que é o comportamento certo, e o sinal de que a tabela precisa crescer.
- Aritmética em `bigint` (`lib/sped/numeros.ts`), nunca `number`: somar 34 mil bases em ponto flutuante acumula erro de centavos e o PVA compara com igualdade exata.

## Rotas de API: por que a lógica não mora em `app/api/` (F3-T3)

Cada `route.ts` é um adaptador de três linhas. A lógica está em `lib/api/{upload,convert,download,files}.ts`, em funções que recebem `Dependencias` — o contrato em `lib/api/dependencias.ts` — em vez de chamarem o Supabase direto.

O motivo é o critério de aceite: teste de integração de caminho feliz, cota esgotada, arquivo grande demais e acesso a arquivo alheio. Com a lógica dentro da rota, isso exigiria banco e dois usuários reais; com a injeção, roda no Vitest, que é puro e offline, exercitando `Request` e `Response` de verdade e o pipeline `lib/sped/` sem mock nenhum.

**O fake de teste não filtra por usuário, de propósito.** Em produção a RLS filtra; se o fake também filtrasse, o teste de acesso alheio estaria testando o fake. Como está, ele só passa porque o handler compara `arquivo.user_id` explicitamente — segunda camada além da RLS. Por isso `obterArquivo(id)` do contrato não recebe `userId`.

Arquivo de outro usuário responde **404, nunca 403**: confirmar que o id existe já é informação sobre a conta alheia, e em dado fiscal isso é vazamento.

`MAX_OCORRENCIAS = 200` em `respostas.ts` corta erros e avisos na resposta e na coluna `jsonb`. Sem o corte, um arquivo de 138 mil linhas produziria dezenas de milhares de avisos, e a resposta HTTP passaria de megabytes. Quem quer a lista inteira tem a aba `_ERROS` do Excel; os totais vão em `total_erros`/`total_avisos`.

`maxDuration = 300` em `/api/convert` porque os 60 s padrão da Vercel não cobrem nem o arquivo de 17 MB (35,6 s só na geração do Excel). Ver "Desempenho medido".

**Verificado de ponta a ponta contra o Supabase real** (30/07/2026), o que os 44 testes não alcançam porque é justamente o que fala com o banco: upload → convert → download pela signed URL → reupload do XLSX → convert de volta devolveu os 5.421 bytes **idênticos ao original**. Exercitou RLS no insert, política de Storage por prefixo `{user_id}/`, leitura do plano em `perfis`, contagem de cota e o 429 na quarta conversão do plano gratuito.

## Particularidades do ambiente (custaram tempo, não redescubra)

- O **TypeScript é 6.x**, mais novo que o assumido pelo `create-next-app`. Duas consequências já tratadas: `baseUrl` está deprecado (usamos só `paths`), e imports de efeito colateral de `.css` exigem declaração — daí `types/estilos.d.ts`, já que o Next só declara `*.module.css`.
- `next-env.d.ts` fica **versionado de propósito**: sem ele, `npm run typecheck` falha em clone novo enquanto o Next não rodar pela primeira vez.
- `eslint-config-next` fica **pinado no major do `next`**. A linha 16 usa flat config nativo e quebra o `FlatCompat` do `eslint.config.mjs` com erro obscuro (`Converting circular structure to JSON`).
- Existe um `package-lock.json` solto em `C:\Users\augus\`; por isso o `outputFileTracingRoot` explícito no `next.config.ts` — sem ele o Next infere a home do usuário como raiz do workspace.
- `npm audit` acusa vulnerabilidades altas em `postcss` e `sharp`, ambas transitivas dentro do próprio `next`. O `fix` sugerido regride o Next para a 9.3.3 — **não rodar `npm audit fix --force`**.
- O Vitest **falha de forma intermitente** nesta máquina ao criar processos de worker: `Error: spawn UNKNOWN` com `errno -4094`. Aparece como `no tests` ou como falhas aparentemente aleatórias que não se repetem. Antes de investigar uma falha de teste, **rode de novo** — se a segunda rodada passa limpa, era isso. Se incomodar, `npx vitest run --pool=threads` costuma contornar.
- O `@supabase/supabase-js` avisa que Node 20 está depreciado e pedirá Node 22+ em versões futuras. Ainda funciona, mas é um upgrade a agendar.
- `npm run build` falha com `EPERM ... .next\trace` quando o dev server está rodando — ele segura o diretório. Pare o dev server antes de buildar.

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
│   ├── apuracao.ts       # AST      → AST com M105/M505 recalculados (ver seção acima)
│   ├── numeros.ts        # decimal exato em bigint — nunca `number` em valor fiscal
│   └── serializer.ts     # AST      → TXT (Latin-1, CRLF, sem linha em branco)
├── api/            # lógica das rotas, testável sem banco — ver F3-T3 abaixo
│   ├── dependencias.ts           # contrato injetado nos handlers
│   ├── dependencias-supabase.ts  # única implementação que fala com Supabase
│   ├── respostas.ts              # { erro, detalhes? } e corte de ocorrências
│   └── {upload,convert,download,files}.ts
├── supabase/{client,server,admin}.ts
└── plans.ts        # limites por plano (free/pro/escritorio), ver spec 4.1
data/layout_efd_contribuicoes.json
supabase/migrations/  # tabelas perfis, arquivos, conversoes — todas com RLS por user_id
```

**Decisão de arquitetura registrada (spec §3.1):** `lib/sped/` é TypeScript puro — sem import de React, Next ou Supabase — para rodar isolado no Vitest e permitir extração futura para pacote npm ou Edge Function.

**Pipeline TXT → XLSX** (spec §3.3): upload valida extensão/tamanho/`|0000|` inicial → `parser.ts` monta a AST resolvendo hierarquia por pilha de níveis → `validator.ts` anota erros/avisos sem bloquear → `to-excel.ts` gera o XLSX (streaming `WorkbookWriter`, células de dados sempre `numFmt: '@'` para não corromper zeros à esquerda, colunas `_{REG}_{CAMPO}` com o contexto do pai) → grava em `outputs/{user_id}/`.

**Pipeline XLSX → TXT** (spec §3.4): `from-excel.ts` lê a aba `_META` (contrato de reconversão — se `layout`/`versao_guia` divergir, recusa) → reconstrói AST por `_ordem`/`_id`/`_pai` → `apuracao.ts` recalcula a base de crédito dos `M105`/`M505` a partir dos documentos → `validator.ts` aqui **bloqueia** em erro → `totalizers.ts` recalcula `X990`/`9900`/`9990`/`9999` → `serializer.ts` gera o TXT final.

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
8. Apagar item de documento (`C170`, `A170`…) invalida a base de cálculo do crédito nos `M105`/`M505`. O PVA confere essa soma e **recusa** o arquivo — recalcular só os totalizadores de linha não basta. Ver "Base de crédito" acima.
9. Os totalizadores `9900`, `9990`, `9999` e `X990` **sempre são recalculados** ao gerar o TXT — `9900` conta a si mesmo entre os tipos de registro, `9990` conta todas as linhas do bloco 9 incluindo ela mesma e a `9999`. A **ordem** em que o `9900` cita os registros não vem da spec: é convenção de quem gerou o arquivo (o real ordena por código dentro do bloco e deixa a entrada do próprio `9900` por último, depois da `9990` e da `9999`). `totalizers.ts` preserva a ordem que o arquivo declarou — sem isso o round-trip byte a byte é impossível em arquivo de terceiro.
10. A ordem dos blocos é fixa: `0 → A → C → D → F → I → M → P → 1 → 9`.
11. Registro filho exige registro pai imediatamente acima na sequência.

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
