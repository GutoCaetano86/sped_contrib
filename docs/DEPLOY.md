# Deploy na Vercel

Passo a passo reproduzível. O Supabase já existe (projeto `xqhebqvnjwspmvrhmqsz`), então este documento cuida de: publicar na Vercel, apontar o Supabase para o domínio novo, ligar o Sentry e agendar o job de retenção.

Tempo estimado na primeira vez: **40 minutos**, quase todos esperando build.

---

## 0. Antes de começar

Confira que o projeto está saudável localmente:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Os quatro precisam passar. O `build` falha com `EPERM ... .next\trace` se o `npm run dev` estiver rodando — pare o dev server antes.

> **Pendência conhecida:** `SUPABASE_SERVICE_ROLE_KEY` está vazia no seu `.env.local`. Nada da aplicação depende dela hoje, mas **o job de retenção não roda sem ela**. O passo 4 resolve.

---

## 1. Subir o código para o GitHub

A Vercel faz deploy a partir de um repositório. Se ainda não existe remoto:

```bash
gh repo create sped-converter --private --source=. --remote=origin --push
```

Se preferir criar pela interface, crie o repositório vazio e depois:

```bash
git remote add origin https://github.com/SEU-USUARIO/sped-converter.git
git push -u origin master
```

Confira que `.env.local` **não** subiu:

```bash
git ls-files | grep -c "^\.env\.local$"
```

Tem de imprimir `0`. O `.gitignore` já cobre, mas vale conferir uma vez — a chave de service role dá acesso irrestrito ao banco.

---

## 2. Criar o projeto na Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → escolha o repositório.
2. A Vercel detecta Next.js sozinha. **Não mexa** em Build Command nem Output Directory.
3. Antes de clicar em **Deploy**, abra **Environment Variables** e preencha o passo 3.

O primeiro deploy vai falhar se faltar variável de ambiente — é esperado, e o passo 5 refaz.

---

## 3. Variáveis de ambiente

Em **Project Settings → Environment Variables**. Marque os três ambientes (Production, Preview, Development) para todas, **menos** onde indicado.

| Variável | Onde achar o valor | Ambientes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | todos |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | idem, chave `publishable` | todos |
| `SUPABASE_SERVICE_ROLE_KEY` | idem, chave `service_role` | **só Production** |
| `CRON_SECRET` | gere você (passo 4) | **só Production** |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry (passo 6) | todos |
| `SENTRY_ORG` | Sentry → Settings → slug da organização | todos |
| `SENTRY_PROJECT` | Sentry → slug do projeto | todos |
| `SENTRY_AUTH_TOKEN` | Sentry → User Settings → Auth Tokens | todos |

**Por que service role só em Production:** ela ignora a RLS. Deploy de preview sai a cada push e a URL é adivinhável; não vale expor a chave que enxerga o banco inteiro para um ambiente descartável. O efeito é que o job de retenção só funciona em produção, que é o que se quer.

O `.env.example` do repositório lista as mesmas variáveis, com comentários.

---

## 4. Segredo do cron

Gere um segredo forte:

```bash
openssl rand -hex 32
```

Guarde em `CRON_SECRET` na Vercel (Production) e, se quiser testar local, em `.env.local`.

**A rota fica fechada sem esta variável.** `segredoConfere()` devolve `false` quando `CRON_SECRET` não existe, então a ausência de configuração resulta em `401`, não em rota aberta. Uma rota que apaga arquivo de todos os usuários não pode ter modo permissivo por engano.

---

## 5. Primeiro deploy

**Deployments → Redeploy** (ou faça um push). Acompanhe o log; o build leva ~2 min.

Quando terminar, anote a URL de produção — algo como `https://sped-converter.vercel.app`.

---

## 6. Sentry

1. [sentry.io](https://sentry.io) → crie a organização e um projeto do tipo **Next.js**.
2. Copie o **DSN** para `NEXT_PUBLIC_SENTRY_DSN`.
3. **User Settings → Auth Tokens** → crie um token com escopo `project:releases` e `org:read`. Vai em `SENTRY_AUTH_TOKEN`.
4. Preencha `SENTRY_ORG` e `SENTRY_PROJECT` com os slugs.
5. Redeploy, para o build subir os source maps.

Sem DSN o Sentry fica **inerte** e a aplicação roda igual — dá para deixar para depois sem quebrar nada.

### O que este projeto faz de diferente

`lib/observabilidade.ts` tem um filtro que roda em **todo** evento antes de sair:

- linha de registro (`|C170|1|...|`) → substituída
- CNPJ e CPF, com ou sem máscara → mascarados
- valor monetário citado pelo validador (`"3757,47"`) → mascarado
- corpo da requisição, cookies e header `Authorization` → removidos

O corpo importa muito: num `POST /api/upload` ele é o arquivo fiscal inteiro, e o Sentry o anexaria por padrão. `tests/observabilidade.test.ts` trava esse comportamento.

`sendDefaultPii` está `false` e não há Session Replay — ele grava a tela, e a tela mostra dado fiscal.

### O SDK do navegador está desligado

Só servidor e edge estão ligados. O SDK do navegador custa **86 kB de JS em toda rota** — mediço: a landing vai de 108 kB para 191 kB de First Load JS, o que derruba o Lighthouse da página que mais depende dele.

O que quebra neste produto quebra no servidor (pipeline de conversão, rotas de API), e isso está coberto. Erros de navegador já aparecem para o usuário nos alertas da interface.

Para ligar assim mesmo, crie `instrumentation-client.ts` na raiz:

```ts
import * as Sentry from '@sentry/nextjs';
import { opcoesComuns } from '@/lib/observabilidade';

Sentry.init({
  ...opcoesComuns,
  // Sem replay de sessão: ele grava a tela, e a tela mostra dado fiscal.
  integrations: [],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

E meça o Lighthouse depois.

---

## 7. Apontar o Supabase para o domínio de produção

Sem isto o login por e-mail e o Google OAuth voltam para `localhost` e falham.

**Supabase → Authentication → URL Configuration:**

- **Site URL:** `https://SEU-DOMINIO.vercel.app`
- **Redirect URLs:** adicione, uma por linha:
  ```
  https://SEU-DOMINIO.vercel.app/auth/callback
  https://SEU-DOMINIO.vercel.app/**
  http://localhost:3000/auth/callback
  ```
  O `/**` cobre os deploys de preview se você usar domínio fixo; mantenha o `localhost` para continuar desenvolvendo.

**Google Cloud Console → Credentials → seu OAuth Client:**

- **Authorized redirect URIs:** tem de conter `https://xqhebqvnjwspmvrhmqsz.supabase.co/auth/v1/callback` — é o Supabase que recebe o retorno do Google, não a sua aplicação.

**Supabase → Authentication → Emails → Confirm signup:** o link precisa ser

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup
```

Se ficar no padrão, a confirmação falha com `PKCE code verifier not found in storage` — o fluxo do e-mail usa `token_hash`, não `code`.

---

## 8. Migrations

As quatro migrations de `supabase/migrations/` já estão aplicadas no projeto. Em banco novo, aplique em ordem pelo SQL Editor ou por:

```bash
npx supabase db push
```

Depois de qualquer mudança de schema, rode **duas** conferências:

```sql
-- no SQL Editor: lança exceção na primeira falha
\i supabase/verifica_rls.sql
```

e o `get_advisors` do painel (Advisors → Security). Ele já pegou um defeito real aqui: função `SECURITY DEFINER` no schema `public` fica exposta via REST.

---

## 9. Job de retenção

O agendamento está em `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/retencao", "schedule": "0 4 * * *" }] }
```

04:00 UTC = 01:00 em Brasília. O plano Hobby da Vercel permite **uma execução por dia**, que é exatamente o que a spec §8 pede.

### Primeira execução: simule antes

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://SEU-DOMINIO.vercel.app/api/cron/retencao?simular=1"
```

Devolve o que *seria* apagado, sem apagar:

```json
{
  "simulacao": true,
  "perfis": 2,
  "arquivos": 4,
  "por_plano": { "free": 4 },
  "por_bucket": { "uploads": 2, "outputs": 2 }
}
```

Confira os números. Só depois rode de verdade, tirando o `?simular=1`.

### O que ele apaga

Arquivo criado antes de `hoje − retenção do plano do dono`: 1 dia no gratuito, 30 no Pro, 90 no Escritório. Plano desconhecido cai no gratuito, que é o mais restritivo.

Storage primeiro, banco depois — na ordem inversa, uma falha deixaria objeto órfão no bucket, invisível e cobrado.

**Apagar a linha de `arquivos` derruba junto as `conversoes` que a citam** (cascade). É intencional: a spec §8 fala em exclusão, e guardar histórico de arquivo que já não existe contraria a minimização da LGPD.

### Conferir depois

**Vercel → Deployments → Crons** mostra a última execução e o status. O log traz só a contagem — nunca caminho nem conteúdo de arquivo.

---

## 10. Verificar em produção

O critério de aceite é conversão funcionando. Faça o caminho inteiro pelo navegador:

1. Abra a URL de produção → a landing carrega.
2. **Criar conta** → confirme o e-mail → cai no `/dashboard` com o estado vazio.
3. **Enviar arquivo** → solte um TXT da EFD → confira CNPJ e período no preview.
4. **Converter** → a tela de detalhe mostra o resumo por registro.
5. **Baixar planilha** → abre no Excel, uma aba por registro.
6. Reenvie a planilha → **converter** → baixe o TXT.
7. `diff` do TXT baixado contra o original: sem edição, tem de ser **idêntico byte a byte**.

O passo 7 é o que prova que o pipeline sobreviveu ao deploy.

```bash
# no Windows, com Git Bash
cmp original.txt baixado_ajustado.txt && echo "idêntico"
```

### Se a conversão der timeout

`/api/convert` tem `maxDuration = 300`. No plano **Hobby** o teto é 60 s, e um arquivo de 17 MB leva ~36 s só na geração do Excel — passa raspando, e um de 50 MB não passa. Ou assine o **Pro** da Vercel, ou limite o tamanho no `lib/plans.ts` até mover o processamento para uma fila (Fase 4).

---

## 11. Domínio próprio (opcional)

**Vercel → Settings → Domains** → adicione, e siga as instruções de DNS.

Depois, **volte ao passo 7** e troque a Site URL e as Redirect URLs do Supabase para o domínio novo — senão o login continua mandando para o `.vercel.app`.

---

## Resumo das variáveis

```
NEXT_PUBLIC_SUPABASE_URL              todos os ambientes
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  todos os ambientes
SUPABASE_SERVICE_ROLE_KEY             só Production
CRON_SECRET                           só Production
NEXT_PUBLIC_SENTRY_DSN                todos (opcional)
SENTRY_ORG                            todos (opcional)
SENTRY_PROJECT                        todos (opcional)
SENTRY_AUTH_TOKEN                     todos (opcional)
```
