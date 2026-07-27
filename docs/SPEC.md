# SPEC — SPED Converter (SaaS de conversão TXT ⇄ Excel para EFD-Contribuições)

> Documento de especificação para desenvolvimento assistido no Claude Code.
> Versão 1.0 — julho/2026 · Autor: Augusto Caetano

---

## 1. Visão do produto

### 1.1 Problema

O arquivo da EFD-Contribuições é um TXT de layout posicional-delimitado (`|`), hierárquico, com 192 tipos de registro e mais de 1.600 campos. Quem precisa corrigir uma escrituração hoje tem três caminhos ruins:

| Caminho | Problema |
| --- | --- |
| Editar o TXT no bloco de notas | Sem nome de campo, sem validação, erro de posição quebra o arquivo inteiro |
| Corrigir dentro do ERP e regerar | Depende de fila de TI, não serve para ajuste pontual |
| Contratar software fiscal completo | Licença cara demais para um ajuste esporádico |

### 1.2 Solução

Aplicação web onde o usuário:

1. Faz upload do TXT da EFD-Contribuições
2. Recebe um `.xlsx` com **uma aba por tipo de registro**, colunas nomeadas conforme o leiaute oficial (`REG`, `COD_VER`, `DT_INI`…)
3. Edita no Excel — a ferramenta que ele já domina
4. Faz upload do Excel de volta e recebe o TXT reconstruído, byte-compatível com o PVA da Receita

### 1.3 Público-alvo

Contadores, analistas fiscais, consultores SAP/ERP e escritórios de contabilidade que precisam de ajuste pontual em escrituração já gerada.

### 1.4 Métricas de sucesso do MVP

| Métrica | Meta |
| --- | --- |
| Round-trip fidelity (TXT → XLSX → TXT idêntico ao original) | 100% em arquivos sem edição |
| Tempo de conversão para arquivo de 50 MB | < 30 s |
| Taxa de arquivos aceitos pelo PVA após reconversão | > 99% |
| Cadastros na primeira semana | 50 |

### 1.5 Fora de escopo no MVP

- Outros layouts SPED (EFD ICMS/IPI, ECD, ECF, Reinf) — a arquitetura prevê, mas não implementa
- Validação de regras de negócio fiscais (cálculo de PIS/COFINS, batimento de CST)
- Assinatura digital e transmissão à Receita
- Edição online do arquivo (o Excel é o editor)

---

## 2. Entendimento do domínio (base técnica)

Fonte: *Guia Prático da EFD-Contribuições, versão 1.35, de 18/06/2021* — Receita Federal do Brasil.

### 2.1 Características do arquivo TXT

| Característica | Valor | Origem no guia |
| --- | --- | --- |
| Encoding | ASCII / ISO-8859-1 (Latin-1) | Cap. II, Seção 2.1 (a) |
| Delimitador | `\|` (pipe, ASCII 124) | Seção 2.1 (e) |
| Início/fim de linha | Toda linha começa e termina com `\|` | Seção 2.1 (e) |
| Quebra de linha | CRLF (`\r\n`) | Seção 2.1 (g) |
| Linhas em branco | **Proibidas** — invalidam a importação no PVA | Cap. II, Seção 1.4 |
| Separador decimal | Vírgula (`,`), sem separador de milhar | Seção 3.1 |
| Data | `ddmmaaaa` | Seção 3.2 |
| Período | `mmaaaa` | Seção 3.3 |
| Hora | `hhmmss` | Seção 3.5 |
| Campo vazio | `\|\|` (dois pipes consecutivos) | Seção 2.1 (h) |
| Tamanho da linha | Variável | Seção 2.1 (c) |

Exemplo real de linha:

```
|0000|006|0|||01012021|31012021|EMPRESA EXEMPLO LTDA|12345678000199|SP|3550308||00|2|
```

### 2.2 Estrutura hierárquica

Blocos, na ordem obrigatória de apresentação:

```
0 → A → C → D → F → I → M → P → 1 → 9
```

| Bloco | Conteúdo | Registros extraídos |
| --- | --- | --- |
| `0` | Abertura, identificação e tabelas de referência | 21 |
| `A` | Documentos fiscais — serviços (ISS) | 8 |
| `C` | Documentos fiscais I — mercadorias (ICMS/IPI) | 48 |
| `D` | Documentos fiscais II — serviços (ICMS) | 23 |
| `F` | Demais documentos e operações | 24 |
| `I` | Instituições financeiras e assemelhadas | (layout em ADE separado) |
| `M` | Apuração de PIS/PASEP e COFINS | 33 |
| `P` | Apuração da CPRB | 8 |
| `1` | Complemento da escrituração | 23 |
| `9` | Controle e encerramento | 4 |

Cada bloco tem registro de abertura (`C001`), registros de dados e encerramento (`C990`). Cada registro declara:

- **Nível hierárquico** (0 a 5) — `0000` é nível 0, `C010` é nível 2, `C100` é nível 3, `C170` é nível 4
- **Ocorrência** — `um (por arquivo)`, `vários por arquivo`, `1:1`, `1:N`

Regra crítica: **um registro filho só existe se houver um registro pai imediatamente acima na sequência do arquivo.** É isso que a reconversão precisa preservar.

### 2.3 Registros de controle do bloco 9

| Registro | Papel | Impacto na reconversão |
| --- | --- | --- |
| `9900` | Uma linha por tipo de registro presente, com a contagem (`REG_BLC`, `QTD_REG_BLC`) | **Deve ser recalculado** a cada geração |
| `9990` | Encerramento do bloco 9 (`QTD_LIN_9`) | **Recalcular** |
| `9999` | Encerramento do arquivo (`QTD_LIN`) — total de linhas do arquivo | **Recalcular** |
| `X990` | Encerramento de cada bloco (`QTD_LIN_X`) | **Recalcular** |

> Se esses totalizadores não forem recalculados após a edição, o PVA rejeita o arquivo. Esta é a regra de negócio mais importante do produto.

### 2.4 Dicionário de leiaute

O arquivo `layout_efd_contribuicoes.json` (entregue junto com esta spec) contém o leiaute extraído programaticamente do PDF oficial:

```jsonc
{
  "layout": "EFD-Contribuicoes",
  "versao_guia": "1.35",
  "arquivo": { "delimitador": "|", "encoding": "ISO-8859-1", ... },
  "total_registros": 192,
  "total_campos": 1624,
  "revisao_manual": [ /* 21 registros com pendências a conferir */ ],
  "registros": {
    "0000": {
      "registro": "0000",
      "bloco": "0",
      "titulo": "Abertura do Arquivo Digital e Identificação da Pessoa Jurídica",
      "nivel": 0,
      "ocorrencia": "um (por arquivo)",
      "pagina_guia": 66,
      "qtd_campos": 14,
      "campos": [
        { "num": 1, "nome": "REG", "descricao": "Texto fixo contendo \"0000\".",
          "tipo": "C", "tamanho": 4, "tamanho_fixo": true,
          "decimais": 0, "obrigatorio": true }
      ]
    }
  }
}
```

**Débito técnico conhecido:** 21 dos 192 registros (≈11%) têm pendência de extração — 1 a 3 campos faltando ou tipo não identificado, por quebra atípica de tabela no PDF. São eles: `0111`, `0500`, `C396`, `C810`, `C820`, `C880`, `D100`, `D201`, `F500`, `F510`, `F550`, `F560`, `M110`, `M220`, `M500`, `1100`, `1300`, `1620`, `1700` e mais 2 flagrados por ausência do campo `REG`. O array `revisao_manual` traz, para cada um, o código do registro, a página do guia e o motivo. **Conferir manualmente antes de ir para produção** — ver tarefa F1-T3.

Os 171 registros restantes foram validados por três critérios automáticos: numeração de campos sequencial de 1 a N, campo 01 sempre `REG`, e todos os campos com tipo `C` ou `N` identificado.

---

## 3. Arquitetura

### 3.1 Stack

| Camada | Tecnologia | Justificativa |
| --- | --- | --- |
| Front-end | Next.js 15 (App Router) + React 19 + TypeScript | SSR, rotas de API no mesmo projeto |
| UI | Tailwind CSS + shadcn/ui | Velocidade de construção |
| API | Route Handlers do Next.js (`app/api/**`) | Um deploy só |
| Auth | Supabase Auth (e-mail/senha + Google OAuth) | Integrado ao Postgres com RLS |
| Banco | Supabase Postgres | RLS nativo por usuário |
| Storage | Supabase Storage (buckets privados) | Signed URLs com expiração |
| Processamento | Node.js — `exceljs` (streaming) + parser próprio | Sem serviço extra no MVP |
| Fila | Nenhuma no MVP; arquivos > 20 MB via Supabase Edge Function | Simplicidade |
| Deploy | Vercel | Integração nativa com Next.js |
| Observabilidade | Vercel Analytics + Sentry | — |

**Decisão de arquitetura registrada:** o parser fica em TypeScript puro, isolado em `lib/sped/`, sem dependência de React, Next ou Supabase. Isso permite testá-lo com Vitest sem subir a aplicação e, no futuro, extraí-lo para um pacote npm ou uma Edge Function.

### 3.2 Estrutura de pastas

```
sped-converter/
├── app/
│   ├── (marketing)/page.tsx           # landing page
│   ├── (auth)/login/page.tsx
│   ├── (app)/
│   │   ├── dashboard/page.tsx         # lista de arquivos
│   │   ├── upload/page.tsx
│   │   └── arquivo/[id]/page.tsx      # detalhe + downloads + erros
│   └── api/
│       ├── upload/route.ts            # POST — recebe TXT ou XLSX
│       ├── convert/route.ts           # POST — dispara conversão
│       ├── download/[id]/route.ts     # GET  — signed URL
│       └── files/route.ts             # GET  — lista paginada
├── lib/
│   ├── sped/
│   │   ├── layout.ts                  # loader + tipos do dicionário
│   │   ├── parser.ts                  # TXT  → AST
│   │   ├── serializer.ts              # AST  → TXT
│   │   ├── to-excel.ts                # AST  → XLSX
│   │   ├── from-excel.ts              # XLSX → AST
│   │   ├── totalizers.ts              # recálculo de 9900/9990/9999/X990
│   │   ├── validator.ts               # validações de tipo/tamanho/obrigatoriedade
│   │   └── types.ts
│   ├── supabase/{client,server,admin}.ts
│   └── plans.ts                       # limites por plano
├── data/
│   └── layout_efd_contribuicoes.json  # dicionário de leiaute
├── scripts/
│   ├── dump_pages.py                  # extração do PDF (fase 1)
│   ├── dump_words.py                  # extração posicional (fase 1b)
│   └── build_layout.py                # geração do dicionário (fase 2)
├── tests/
│   ├── fixtures/*.txt
│   └── sped/*.test.ts
└── supabase/migrations/
```

### 3.3 Fluxo de conversão TXT → XLSX

```
Upload TXT
   ↓ valida extensão, tamanho, primeira linha começa com |0000|
Storage: uploads/{user_id}/{file_id}.txt
   ↓
parser.ts        → AST (árvore de registros com hierarquia resolvida)
   ↓
validator.ts     → lista de erros/avisos (não bloqueia)
   ↓
to-excel.ts      → XLSX com uma aba por tipo de registro
   ↓
Storage: outputs/{user_id}/{file_id}.xlsx
   ↓
DB: conversions.status = 'concluido'
```

### 3.4 Fluxo de conversão XLSX → TXT

```
Upload XLSX
   ↓ valida presença da aba _META e da aba 0000
from-excel.ts    → AST (reordena por _ordem, reconstrói hierarquia por _id/_pai)
   ↓
validator.ts     → erros bloqueantes impedem a geração
   ↓
totalizers.ts    → recalcula X990, 9900, 9990, 9999
   ↓
serializer.ts    → TXT (Latin-1, CRLF, sem linha em branco)
   ↓
Storage: outputs/{user_id}/{file_id}_reconvertido.txt
```

---

## 4. Modelo de dados (Supabase)

```sql
-- perfis (espelha auth.users)
create table public.perfis (
  id           uuid primary key references auth.users on delete cascade,
  nome         text,
  empresa      text,
  plano        text not null default 'free'
                 check (plano in ('free','pro','escritorio')),
  criado_em    timestamptz not null default now()
);

-- arquivos enviados
create table public.arquivos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  nome_original  text not null,
  tipo           text not null check (tipo in ('txt','xlsx')),
  tamanho_bytes  bigint not null,
  storage_path   text not null,
  hash_sha256    text,
  -- metadados extraídos do registro 0000
  cnpj           text,
  razao_social   text,
  periodo_inicio date,
  periodo_fim    date,
  criado_em      timestamptz not null default now()
);

-- conversões
create table public.conversoes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  arquivo_origem_id uuid not null references public.arquivos on delete cascade,
  arquivo_saida_id  uuid references public.arquivos on delete set null,
  direcao           text not null check (direcao in ('txt_para_xlsx','xlsx_para_txt')),
  status            text not null default 'pendente'
                      check (status in ('pendente','processando','concluido','erro')),
  total_linhas      integer,
  total_registros   integer,
  erros             jsonb default '[]'::jsonb,
  avisos            jsonb default '[]'::jsonb,
  duracao_ms        integer,
  criado_em         timestamptz not null default now(),
  concluido_em      timestamptz
);

create index on public.arquivos (user_id, criado_em desc);
create index on public.conversoes (user_id, criado_em desc);

-- RLS: cada usuário só enxerga o que é dele
alter table public.perfis     enable row level security;
alter table public.arquivos   enable row level security;
alter table public.conversoes enable row level security;

create policy "proprio_perfil"      on public.perfis
  for all using (auth.uid() = id);
create policy "proprios_arquivos"   on public.arquivos
  for all using (auth.uid() = user_id);
create policy "proprias_conversoes" on public.conversoes
  for all using (auth.uid() = user_id);
```

### 4.1 Planos e limites (`lib/plans.ts`)

| Plano | Conversões/mês | Tamanho máx. | Retenção | Preço sugerido |
| --- | --- | --- | --- | --- |
| `free` | 3 | 5 MB | 24 h | R$ 0 |
| `pro` | 50 | 50 MB | 30 dias | R$ 79/mês |
| `escritorio` | 500 | 200 MB | 90 dias | R$ 249/mês |

Cobrança manual no MVP (Stripe entra na Fase 4). O limite é conferido em `/api/convert` antes de processar.

---

## 5. Especificação do parser

### 5.1 Tipos (`lib/sped/types.ts`)

```ts
export interface CampoLayout {
  num: number;
  nome: string;
  descricao: string;
  tipo: 'C' | 'N';
  tamanho: number;         // 0 = variável
  tamanho_fixo: boolean;   // "*" no guia: exige exatamente N caracteres
  decimais: number;
  obrigatorio: boolean;
}

export interface RegistroLayout {
  registro: string;
  bloco: string;
  titulo: string;
  nivel: number | null;
  ocorrencia: string | null;
  qtd_campos: number;
  campos: CampoLayout[];
}

/** Uma linha do arquivo, já resolvida na árvore. */
export interface NoRegistro {
  id: string;              // uuid curto, estável dentro da conversão
  paiId: string | null;
  reg: string;             // "C100"
  nivel: number;
  ordem: number;           // posição original no arquivo (1-based)
  valores: string[];       // valores crus, SEM os pipes das pontas
  linhaOriginal: number;   // nº da linha no TXT, para mensagens de erro
}

export interface ResultadoParse {
  nos: NoRegistro[];
  cabecalho: { cnpj: string; razaoSocial: string; dtIni: string; dtFin: string };
  erros: ErroValidacao[];
  avisos: ErroValidacao[];
}

export interface ErroValidacao {
  severidade: 'erro' | 'aviso';
  linha?: number;
  aba?: string;
  registro?: string;
  campo?: string;
  mensagem: string;
}
```

### 5.2 `parser.ts` — TXT → AST

**Contrato:** `parseTxt(conteudo: Buffer, layout: Layout): ResultadoParse`

Algoritmo:

1. Decodificar de `latin1` para string.
2. Quebrar por `\r\n` ou `\n`. Descartar a última linha se vazia; **qualquer outra linha vazia gera erro** (regra do PVA).
3. Para cada linha:
   - Validar que começa e termina com `|`. Se não, erro na linha e segue.
   - `valores = linha.slice(1, -1).split('|')` — os pipes das pontas são delimitadores, não conteúdo.
   - `reg = valores[0]`. Se não existir no dicionário, registrar **aviso** (registro desconhecido) e preservar a linha como opaca — nunca descartar dados do usuário.
   - Se a quantidade de valores divergir de `qtd_campos`, registrar aviso e preencher/truncar.
4. Resolver hierarquia com uma pilha indexada por nível:
   - `pilha[nivel] = noAtual`
   - `paiId = pilha[nivel - 1]?.id ?? null`
   - Se não houver pai para um registro de nível > 0, **aviso** (arquivo malformado), `paiId = null`.
5. Extrair cabeçalho do registro `0000` (campos 6 a 9: `DT_INI`, `DT_FIN`, `NOME`, `CNPJ`).

**Regras de robustez obrigatórias:**

- Nunca lançar exceção por conteúdo inválido — acumular em `erros`/`avisos` e prosseguir.
- Preservar valores exatamente como vieram (sem `trim`, sem normalizar zeros à esquerda). Zero à esquerda de CNPJ/CPF é significativo.
- Registros de níveis "pulados" (ex.: nível 4 logo após nível 2) não devem quebrar a pilha.

### 5.3 `to-excel.ts` — AST → XLSX

**Contrato:** `gerarExcel(res: ResultadoParse, layout: Layout): Promise<Buffer>`

Estrutura da planilha:

**Aba `_META`** (primeira, protegida, fundo cinza)

| Coluna | Conteúdo |
| --- | --- |
| `chave` / `valor` | `layout` = `EFD-Contribuicoes`, `versao_guia` = `1.35`, `arquivo_origem`, `cnpj`, `razao_social`, `periodo`, `total_linhas`, `gerado_em`, `hash_origem` |

> A aba `_META` é o contrato de reconversão. Se ela não existir ou o `layout` divergir, `/api/convert` recusa o Excel.

**Uma aba por tipo de registro presente no arquivo**, nomeada com o código (`0000`, `C100`, `C170`…), na ordem oficial dos blocos.

Colunas de cada aba:

| Coluna | Origem | Visível | Papel |
| --- | --- | --- | --- |
| `_id` | `no.id` | Não (oculta) | Identidade da linha |
| `_pai` | `no.paiId` | Não (oculta) | Vínculo hierárquico |
| `_ordem` | `no.ordem` | Sim | Posição no arquivo; **é a chave da reconstrução** |
| `REG` … | `campos[].nome` | Sim | Um por campo do leiaute |

Formatação:

- Linha 1 = cabeçalho: nome do campo, negrito, fundo `#1F4E79`, texto branco, painel congelado (`freeze panes` em `D2`), autofiltro.
- Linha 2 = descrição resumida do campo em itálico cinza (`descricao`, truncada em 120 caracteres). Opcional, controlada por flag `incluirDescricoes`.
- Comentário de célula no cabeçalho com tipo/tamanho/obrigatoriedade (`C 004* · obrigatório`).
- **Todas as células de dados formatadas como TEXTO** (`numFmt: '@'`). Isso é inegociável: sem isso o Excel converte `00123` em `123` e `0,65` em número com ponto, corrompendo o arquivo.
- Colunas `_id` e `_pai` ocultas (`hidden: true`) e protegidas.
- Largura de coluna: `min(max(nome.length + 2, 12), 40)`.

Aba `_ERROS` (só se houver ocorrências): `severidade`, `linha`, `registro`, `campo`, `mensagem`.

Usar `exceljs` em modo **streaming writer** (`WorkbookWriter`) — um arquivo de 50 MB de TXT pode gerar centenas de milhares de linhas.

### 5.4 `from-excel.ts` — XLSX → AST

**Contrato:** `lerExcel(buf: Buffer, layout: Layout): ResultadoParse`

Algoritmo:

1. Ler `_META`; validar `layout` e `versao_guia`. Divergência → erro bloqueante.
2. Para cada aba cujo nome exista no dicionário:
   - Mapear cabeçalho (linha 1) para índices de campo. **Nunca assumir a ordem das colunas** — o usuário pode reordenar.
   - Detectar e pular a linha de descrição (linha 2) se presente.
   - Ler as linhas de dados, montando `NoRegistro`.
   - Converter todo valor para string; se o Excel devolver `number` ou `Date`, formatar conforme o tipo do campo (`N` com `decimais`, data como `ddmmaaaa`).
3. Ordenar todos os nós por `_ordem`.
4. Reconstruir hierarquia: preferir `_pai` quando o `_id` existir; caso o usuário tenha inserido linhas novas (sem `_id`), recalcular pela pilha de níveis, como no parser.
5. Linhas novas sem `_ordem`: inserir logo após a última linha do mesmo tipo de registro, preservando a ordem relativa do bloco.

**Casos de borda que precisam de teste:**

| Caso | Comportamento esperado |
| --- | --- |
| Usuário apaga uma linha `C100` que tinha filhos `C170` | Erro bloqueante: "registro filho órfão" |
| Usuário adiciona linha sem `_id`/`_pai` | Gerar `_id` novo; inferir pai pela ordem |
| Usuário reordena colunas | Funciona (mapeamento por nome) |
| Usuário renomeia uma aba | Aviso; aba ignorada |
| Usuário deixa célula obrigatória vazia | Erro bloqueante com aba/linha/campo |
| Excel converteu `00123` em `123` | Aviso de possível perda de zero à esquerda quando `tamanho_fixo` |

### 5.5 `totalizers.ts` — recálculo obrigatório

**Contrato:** `recalcularTotalizadores(nos: NoRegistro[]): NoRegistro[]`

Ordem de execução:

1. Remover todos os registros `9900`, `9990`, `9999` e `X990` existentes.
2. Recriar `X990` ao fim de cada bloco: `QTD_LIN_X` = total de linhas do bloco, **incluindo** a própria linha de encerramento.
3. Recriar `9900`: uma linha por tipo de registro presente, na ordem de aparição, com `REG_BLC` e `QTD_REG_BLC`. **Incluir o próprio `9900` na contagem** (o número de linhas 9900 é igual ao número de tipos distintos de registro, contando 9900, 9990 e 9999).
4. `9990`: `QTD_LIN_9` = linhas do bloco 9 (todas as 9900 + o próprio 9990 + o 9999).
5. `9999`: `QTD_LIN` = total de linhas do arquivo.

> Este módulo tem a maior densidade de bugs do projeto. Escrever os testes **antes** da implementação, usando um arquivo real validado pelo PVA como fixture.

### 5.6 `serializer.ts` — AST → TXT

**Contrato:** `serializarTxt(nos: NoRegistro[]): Buffer`

1. Ordenar por `ordem`.
2. Para cada nó: `'|' + valores.join('|') + '|'`.
3. Unir com `\r\n`; terminar o arquivo com `\r\n`.
4. Codificar em `latin1`. Caracteres fora do Latin-1 → substituir pelo equivalente sem acento e emitir aviso.
5. Garantir ausência de linhas em branco.

### 5.7 `validator.ts`

Validações por campo, aplicadas nas duas direções:

| Regra | Severidade |
| --- | --- |
| Campo obrigatório vazio | erro |
| `tamanho_fixo` e comprimento ≠ `tamanho` | erro |
| Comprimento > `tamanho` (quando `tamanho` > 0) | erro |
| Tipo `N` com caractere não numérico (exceto `,` e `-`) | erro |
| Valor contém `\|` | erro |
| Data fora do padrão `ddmmaaaa` ou inválida | erro |
| CNPJ/CPF com dígito verificador inválido | aviso |
| Registro desconhecido no dicionário | aviso |
| Quantidade de campos ≠ leiaute | aviso |
| Decimais acima do declarado | aviso |

`erro` bloqueia a geração do TXT; `aviso` apenas informa.

---

## 6. API

Todas as rotas exigem sessão Supabase válida. Erros seguem `{ erro: string, detalhes?: unknown }` com status HTTP adequado.

### `POST /api/upload`

`multipart/form-data` com `arquivo`.

- Valida extensão (`.txt`, `.xlsx`), tamanho (limite do plano) e MIME.
- Para `.txt`: valida que a primeira linha começa com `|0000|`.
- Sobe para `uploads/{user_id}/{uuid}.{ext}`, insere em `arquivos`.

```json
{ "arquivo_id": "uuid", "nome": "efd_202101.txt", "tamanho_bytes": 8421376, "tipo": "txt" }
```

### `POST /api/convert`

```json
{ "arquivo_id": "uuid", "direcao": "txt_para_xlsx", "incluir_descricoes": true }
```

- Confere a cota do plano no mês corrente.
- Cria `conversoes` com status `processando`.
- Executa o pipeline; grava a saída no Storage; atualiza status, `erros`, `avisos` e `duracao_ms`.

```json
{
  "conversao_id": "uuid",
  "status": "concluido",
  "arquivo_saida_id": "uuid",
  "total_linhas": 128430,
  "total_registros": 47,
  "erros": [],
  "avisos": [
    { "severidade": "aviso", "linha": 5821, "registro": "C170",
      "campo": "COD_NCM", "mensagem": "Campo com 7 caracteres; leiaute prevê 8." }
  ]
}
```

### `GET /api/download/[arquivo_id]`

Retorna signed URL do Supabase Storage com validade de 5 minutos.

### `GET /api/files?pagina=1&por_pagina=20`

Lista arquivos e conversões do usuário, ordenados por data decrescente.

---

## 7. Interface

### 7.1 Landing (`/`)

Hero com a proposta em uma linha ("Edite seu SPED no Excel. Sem quebrar o arquivo."), demonstração em três passos, tabela de planos, FAQ sobre segurança dos dados fiscais.

### 7.2 Dashboard (`/dashboard`)

Tabela de arquivos: nome, CNPJ, período, tipo, status da última conversão, data, ações (converter/baixar/excluir). Barra de cota do plano no topo.

### 7.3 Upload (`/upload`)

Dropzone com `react-dropzone`, barra de progresso, detecção automática da direção pela extensão. Após o upload, preview do cabeçalho lido do `0000` (CNPJ, razão social, período) para o usuário confirmar que subiu o arquivo certo.

### 7.4 Detalhe do arquivo (`/arquivo/[id]`)

- Cabeçalho: CNPJ, razão social, período, total de linhas
- Tabela resumo: registros por tipo com contagem (útil para conferência)
- Painel de erros e avisos agrupado por severidade, com aba/linha/campo clicáveis
- Botões de download

### 7.5 Estados que precisam existir

Vazio (sem arquivos), carregando (skeleton), processando (polling a cada 2 s), erro de conversão com mensagem acionável, cota esgotada com CTA de upgrade.

---

## 8. Segurança e LGPD

Arquivo de EFD-Contribuições contém dados fiscais sigilosos — CNPJ, faturamento, base de cálculo, participantes. Tratar como dado sensível.

| Controle | Implementação |
| --- | --- |
| Isolamento entre usuários | RLS no Postgres + prefixo `{user_id}/` no Storage |
| Buckets privados | Sem acesso público; apenas signed URLs de 5 min |
| Criptografia em trânsito | HTTPS obrigatório (padrão Vercel) |
| Criptografia em repouso | Padrão do Supabase Storage (AES-256) |
| Retenção | Job diário apaga arquivos além da retenção do plano |
| Exclusão pelo usuário | Botão "excluir permanentemente" remove do Storage e do banco |
| Logs | Nunca registrar conteúdo de arquivo em log; apenas `arquivo_id` e métricas |
| Rate limiting | 10 conversões/hora por usuário, independente do plano |
| Antivírus | Fora de escopo no MVP; validar apenas extensão e assinatura de arquivo |
| Política de privacidade | Página `/privacidade` declarando finalidade, retenção e não uso dos dados para treinar modelos |

---

## 9. Testes

### 9.1 Unitários (Vitest)

| Alvo | Casos mínimos |
| --- | --- |
| `parser` | Linha bem-formada; sem pipe inicial; linha vazia no meio; registro desconhecido; qtd. de campos divergente; hierarquia com nível pulado |
| `serializer` | Round-trip; encoding Latin-1 com acentos; CRLF; ausência de linha em branco |
| `totalizers` | Recálculo de `9900` com N tipos; `X990` por bloco; `9999` total; arquivo com bloco vazio |
| `validator` | Cada regra da tabela 5.7, positiva e negativa |
| `to-excel` / `from-excel` | Colunas reordenadas; aba renomeada; linha inserida; zero à esquerda preservado |

### 9.2 Integração — teste de ouro

O teste mais importante do projeto:

```ts
test('round-trip preserva o arquivo byte a byte', async () => {
  const original = readFileSync('tests/fixtures/efd_real_validado.txt');
  const ast = parseTxt(original, layout);
  const xlsx = await gerarExcel(ast, layout);
  const volta = lerExcel(xlsx, layout);
  const saida = serializarTxt(recalcularTotalizadores(volta.nos));
  expect(saida.equals(original)).toBe(true);
});
```

Se o arquivo original tiver totalizadores corretos, a saída deve ser idêntica. Qualquer divergência aponta bug em totalizadores, ordenação ou encoding.

### 9.3 Fixtures necessárias

| Arquivo | Origem |
| --- | --- |
| `efd_minimo.txt` | Só `0000` + `9999` + encerramentos |
| `efd_real_validado.txt` | Arquivo real anonimizado, já aprovado pelo PVA |
| `efd_com_erros.txt` | Erros propositais para testar o validador |
| `efd_grande.txt` | ~50 MB, para teste de performance |

> **Obter um arquivo real validado pelo PVA antes de começar a Fase 2.** Sem ele, o desenvolvimento fica cego.

### 9.4 Validação final

Rodar o TXT reconvertido no PVA oficial da EFD-Contribuições. É o único critério de aceite que importa.

---

## 10. Roadmap

### Fase 1 — Núcleo do parser (sem interface)

| # | Tarefa | Entrega |
| --- | --- | --- |
| F1-T1 | Scaffolding Next.js + TS + Tailwind + Vitest | Projeto rodando |
| F1-T2 | `layout.ts`: loader tipado do dicionário | Tipos + testes |
| F1-T3 | Conferir manualmente os 19 registros de `revisao_manual` | Dicionário 100% |
| F1-T4 | `parser.ts` + testes | TXT → AST |
| F1-T5 | `serializer.ts` + teste de round-trip | AST → TXT idêntico |
| F1-T6 | `totalizers.ts` + testes | Totalizadores corretos |
| F1-T7 | `validator.ts` + testes | Todas as regras de 5.7 |

**Critério de saída:** `parse → serialize` devolve o arquivo original byte a byte via CLI, sem interface.

### Fase 2 — Conversão Excel

| # | Tarefa |
| --- | --- |
| F2-T1 | `to-excel.ts` com streaming e formatação |
| F2-T2 | `from-excel.ts` com mapeamento por nome de coluna |
| F2-T3 | Teste de ouro round-trip completo |
| F2-T4 | CLI `npm run convert -- arquivo.txt` para uso interno |

**Critério de saída:** round-trip completo TXT → XLSX → TXT passando, e o TXT reconvertido aprovado no PVA.

### Fase 3 — SaaS

| # | Tarefa |
| --- | --- |
| F3-T1 | Supabase: migrations, RLS, buckets |
| F3-T2 | Auth (e-mail/senha + Google) |
| F3-T3 | Rotas de API |
| F3-T4 | Dashboard, upload, detalhe do arquivo |
| F3-T5 | Cotas por plano + rate limiting |
| F3-T6 | Landing + página de privacidade |
| F3-T7 | Deploy na Vercel |

### Fase 4 — Monetização e escala

Stripe (checkout + webhooks), fila para arquivos grandes (Edge Function), histórico com diff entre versões, suporte a EFD ICMS/IPI via novo dicionário, API pública com chave.

---

## 11. Decisões registradas

| # | Decisão | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| 1 | Uma aba por tipo de registro | Aba única linearizada | Edição em massa por tipo é o caso de uso real |
| 2 | Colunas `_id`/`_pai`/`_ordem` ocultas | Reconstruir só pela ordem | Permite detectar órfãos e linhas inseridas |
| 3 | Todas as células como texto | Deixar o Excel inferir | Preserva zero à esquerda e vírgula decimal |
| 4 | Parser em TypeScript no Next.js | Backend Python separado | Um deploy só; `exceljs` resolve streaming |
| 5 | Totalizadores sempre recalculados | Confiar no que veio do Excel | Usuário edita linhas; contagem sempre muda |
| 6 | Erros não bloqueiam TXT → XLSX | Recusar arquivo com erro | O usuário quer justamente ver e corrigir os erros |
| 7 | Erros bloqueiam XLSX → TXT | Gerar com erro e avisar | Gerar arquivo que o PVA rejeita é pior que não gerar |
| 8 | Dicionário em JSON versionado | Hardcode em TS | Permite outros layouts sem recompilar lógica |

---

## 12. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Lacunas nos 19 registros do dicionário | Alto | F1-T3 antes de qualquer release |
| Excel corrompe zeros à esquerda ao editar | Alto | Células como texto + aviso no validador + instrução na aba `_META` |
| Arquivo de 200 MB estoura memória da serverless | Médio | Streaming; acima de 20 MB, mover para Edge Function |
| Mudança de versão do leiaute pela Receita | Médio | Dicionário versionado; suportar múltiplas versões por `COD_VER` |
| Usuário sobe Excel de outro arquivo | Médio | `hash_origem` na `_META`; avisar divergência |
| Responsabilidade sobre erro fiscal | Alto | Termos de uso: ferramenta de conversão, não de consultoria fiscal; conferência final é do usuário |
