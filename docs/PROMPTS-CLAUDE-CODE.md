# Prompts prontos para o Claude Code

Execute na ordem. Cada prompt é uma sessão de trabalho fechada, com critério de aceite verificável.

## Preparação (uma vez)

```bash
mkdir sped-converter && cd sped-converter
git init
mkdir -p docs data scripts
# copie para dentro do projeto:
#   SPEC.md                       -> docs/SPEC.md
#   CLAUDE.md                     -> CLAUDE.md (raiz)
#   layout_efd_contribuicoes.json -> data/layout_efd_contribuicoes.json
#   dump_pages.py, dump_words.py, build_layout.py -> scripts/
claude
```

---

## F1-T1 — Scaffolding

```
Leia CLAUDE.md e docs/SPEC.md (seções 3.1 e 3.2).

Crie o projeto Next.js 15 com App Router, TypeScript strict, Tailwind CSS,
shadcn/ui e Vitest, seguindo exatamente a estrutura de pastas da seção 3.2
da spec. Não implemente lógica de negócio ainda — apenas o esqueleto, os
arquivos de configuração e os scripts de npm listados no CLAUDE.md.

Critério de aceite: `npm run dev`, `npm run test` e `npm run typecheck`
rodam sem erro.
```

## F1-T2 — Loader do dicionário de leiaute

```
Leia docs/SPEC.md seções 2.4 e 5.1.

Implemente lib/sped/types.ts e lib/sped/layout.ts:
- tipos CampoLayout, RegistroLayout, Layout, NoRegistro, ResultadoParse,
  ErroValidacao exatamente como na seção 5.1
- carregarLayout(): lê data/layout_efd_contribuicoes.json, valida a
  estrutura com zod e devolve um objeto tipado com índice por código de
  registro e acesso O(1) a campo por nome
- testes cobrindo: registro existente, registro inexistente, campo por
  nome, contagem total de 192 registros

Critério de aceite: testes passando e `npm run typecheck` limpo.
```

## F1-T3 — Fechar lacunas do dicionário

```
O arquivo data/layout_efd_contribuicoes.json tem um array "revisao_manual"
com 21 registros cuja extração automática do PDF ficou incompleta (quebra
atípica de tabela no guia). Cada entrada traz o registro, a página do guia e
o motivo.

Para cada entrada, consulte a página indicada do Guia Prático da
EFD-Contribuições v1.35 e complete os campos faltando, mantendo o mesmo
formato dos demais (num, nome, descricao, tipo, tamanho, tamanho_fixo,
decimais, obrigatorio).

Ao terminar, esvazie o array "revisao_manual" e escreva um teste de
integridade do dicionário que falhe se qualquer registro tiver: numeração de
campo não sequencial de 1 a N, campo 01 diferente de REG, ou campo com tipo
diferente de C/N.

Critério de aceite: teste de integridade do dicionário passando.
```

## F1-T4 — Parser TXT → AST

```
Leia docs/SPEC.md seção 5.2.

Implemente lib/sped/parser.ts com a função parseTxt, seguindo o algoritmo e
todas as regras de robustez da seção. Crie as fixtures de teste da seção 9.3
(comece por efd_minimo.txt, que você mesmo pode montar).

Testes obrigatórios: linha bem-formada, linha sem pipe inicial, linha vazia
no meio do arquivo, registro desconhecido, quantidade de campos divergente,
hierarquia com nível pulado, extração do cabeçalho do registro 0000.

Lembre: o parser nunca lança exceção por conteúdo inválido do usuário.

Critério de aceite: todos os testes passando.
```

## F1-T5 — Serializer AST → TXT

```
Leia docs/SPEC.md seções 5.6 e 9.2.

Implemente lib/sped/serializer.ts e o teste de round-trip:
parseTxt(original) -> serializarTxt(...) deve devolver buffer idêntico ao
original, byte a byte.

Atenção a encoding Latin-1, CRLF, pipes das pontas e ausência de linha em
branco. Teste com acentuação (ç, ã, é) no campo NOME do registro 0000.

Critério de aceite: round-trip byte a byte passando na fixture efd_minimo.txt.
```

## F1-T6 — Totalizadores

```
Leia docs/SPEC.md seções 2.3 e 5.5. Este é o módulo mais propenso a bug do
projeto — escreva os testes ANTES da implementação.

Implemente lib/sped/totalizers.ts com recalcularTotalizadores, respeitando:
- X990 conta a própria linha de encerramento
- 9900 conta o próprio registro 9900 entre os tipos
- 9990 conta todas as linhas do bloco 9, incluindo ela mesma e a 9999
- 9999 é o total de linhas do arquivo

Testes: arquivo mínimo, arquivo com todos os blocos, bloco vazio, registro
com ocorrência única, arquivo onde os totalizadores originais já estão
corretos (resultado deve ser idêntico ao original).

Critério de aceite: testes passando e round-trip continuando byte a byte.
```

## F1-T7 — Validador

```
Leia docs/SPEC.md seção 5.7.

Implemente lib/sped/validator.ts cobrindo todas as regras da tabela, com um
teste positivo e um negativo para cada. Inclua validação de dígito
verificador de CNPJ e CPF (severidade aviso).

Critério de aceite: cobertura de todas as linhas da tabela 5.7.
```

## F2-T1 — Geração do Excel

```
Leia docs/SPEC.md seção 5.3.

Implemente lib/sped/to-excel.ts usando exceljs em modo streaming
(WorkbookWriter). Siga à risca a estrutura de abas, as colunas de controle
ocultas (_id, _pai, _ordem), a formatação de cabeçalho e — o ponto mais
importante — todas as células de dados formatadas como TEXTO (numFmt '@').

Critério de aceite: gerar o XLSX da fixture, abrir programaticamente e
verificar que "00123" continua "00123" e "0,65" continua "0,65".
```

## F2-T2 — Leitura do Excel

```
Leia docs/SPEC.md seção 5.4, com atenção especial à tabela de casos de borda.

Implemente lib/sped/from-excel.ts. O mapeamento de colunas é POR NOME, nunca
por posição — o usuário pode reordenar colunas no Excel.

Escreva um teste para cada linha da tabela de casos de borda da seção 5.4.

Critério de aceite: todos os casos de borda cobertos.
```

## F2-T3 — Teste de ouro

```
Leia docs/SPEC.md seção 9.2.

Implemente o teste de round-trip completo:
TXT -> AST -> XLSX -> AST -> totalizadores -> TXT

Use a fixture efd_real_validado.txt. Se eu ainda não tiver fornecido esse
arquivo, gere um TXT sintético realista com pelo menos os registros 0000,
0001, 0110, 0140, 0150, 0200, 0990, C001, C010, C100, C170, C990, M001,
M100, M200, M990, 9001, 9900, 9990, 9999 e me avise que preciso substituir
por um arquivo real validado no PVA.

Critério de aceite: saída idêntica à entrada, byte a byte.
```

## F2-T4 — CLI interna

```
Crie scripts/convert.ts e o npm script "convert", permitindo:
  npm run convert -- entrada.txt --saida saida.xlsx
  npm run convert -- entrada.xlsx --saida saida.txt

A CLI imprime resumo: total de linhas, registros por tipo, erros e avisos
agrupados por severidade.

Critério de aceite: converter a fixture nas duas direções pela linha de
comando.
```

## F3-T1 — Banco e storage

```
Leia docs/SPEC.md seção 4.

Crie as migrations do Supabase em supabase/migrations/ com as tabelas
perfis, arquivos e conversoes, índices e políticas de RLS exatamente como na
spec. Crie os buckets privados "uploads" e "outputs" e um trigger que cria o
perfil automaticamente ao inserir em auth.users.

Implemente lib/supabase/{client,server,admin}.ts e lib/plans.ts com os
limites da seção 4.1.

Critério de aceite: migrations aplicam sem erro; teste confirmando que um
usuário não consegue ler arquivo de outro.
```

## F3-T2 — Autenticação

```
Implemente autenticação com Supabase Auth: e-mail/senha e Google OAuth.
Páginas /login e /cadastro, middleware protegendo o grupo de rotas (app),
callback de OAuth e logout.

Critério de aceite: fluxo completo de cadastro, login e logout funcionando.
```

## F3-T3 — Rotas de API

```
Leia docs/SPEC.md seção 6.

Implemente as quatro rotas: POST /api/upload, POST /api/convert,
GET /api/download/[id], GET /api/files. Respeite validações, cotas por
plano, rate limiting de 10 conversões/hora e o formato de resposta de erro.

Critério de aceite: testes de integração cobrindo caminho feliz, cota
esgotada, arquivo grande demais e acesso a arquivo de outro usuário.
```

## F3-T4 — Interface

```
Leia docs/SPEC.md seção 7.

Implemente dashboard, upload (com dropzone e preview do cabeçalho 0000) e
página de detalhe do arquivo, incluindo todos os estados da seção 7.5:
vazio, carregando, processando com polling, erro e cota esgotada.

Use shadcn/ui. Interface em português.

Critério de aceite: fluxo completo pelo navegador, do upload ao download.
```

## F3-T5 — Landing e privacidade

```
Leia docs/SPEC.md seções 7.1 e 8.

Crie a landing page e a página /privacidade. A landing precisa responder à
objeção central do público: "por que eu confiaria meu arquivo fiscal a
vocês?" — deixe explícita a retenção por plano, a exclusão permanente sob
demanda e o não uso dos dados para qualquer outra finalidade.

Critério de aceite: páginas responsivas e com bom Lighthouse.
```

## F3-T6 — Deploy

```
Leia docs/SPEC.md seção 10, Fase 3.

Prepare o deploy na Vercel: variáveis de ambiente, integração com Supabase,
Sentry, e um job diário (cron da Vercel) que apaga arquivos além da retenção
do plano.

Escreva docs/DEPLOY.md com o passo a passo para eu reproduzir.

Critério de aceite: aplicação no ar e conversão funcionando em produção.
```

---

## Dicas de uso

- Rode `/init` na primeira sessão para o Claude Code indexar o projeto.
- Peça o plano antes da implementação em tarefas grandes: *"me mostre o plano antes de escrever código"*.
- Depois de cada fase: `npm run test && npm run typecheck && npm run lint`.
- Commite ao fim de cada tarefa. Mensagens em português, no imperativo.
- Se o Claude Code começar a divergir da spec, aponte a seção: *"reveja a seção 5.5 da spec, o 9900 conta a si mesmo"*.
