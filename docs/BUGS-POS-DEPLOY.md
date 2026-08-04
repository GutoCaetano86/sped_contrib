# Bugs encontrados no primeiro teste em produção (F3-T7)

Ambiente: `https://sped-contrib.vercel.app` · testado em 02/08/2026 · conta `augusto.maria86@gmail.com`.

Cinco defeitos, em ordem de gravidade. **B3 bloqueia o produto inteiro** — sem upload não há nada. B1 e B2 barram o cadastro de novos usuários. B4 e B5 são de acabamento, mas B4 faz o usuário achar que o download não funciona.

Cada item traz sintoma observado, evidência, hipótese investigada no código e critério de aceite. A hipótese é ponto de partida, **não conclusão** — confirme antes de corrigir.

---

## B3 — Upload falha em produção: "Resposta inesperada do servidor"

**Prioridade: bloqueante.** Corrigir primeiro.

### Sintoma

Em `/upload`, ao soltar qualquer arquivo, aparece o painel vermelho:

```
Não deu para enviar
Resposta inesperada do servidor.
```

Funciona em desenvolvimento; falha em produção.

### O que essa mensagem significa de fato

Ela vem de `app/(app)/upload/page.tsx`, linha ~85:

```ts
try {
  corpo = JSON.parse(req.responseText);
} catch {
  setErro('Resposta inesperada do servidor.');
  return;
}
```

Ou seja: **o servidor devolveu algo que não é JSON.** Todas as respostas de `lib/api/upload.ts` são JSON, inclusive as de erro. Então a resposta não veio do handler — veio da plataforma, ou o handler morreu antes de responder.

### Primeiro passo obrigatório: parar de esconder o diagnóstico

O `catch` descarta o status HTTP e o corpo. Enquanto isso não mudar, qualquer correção é chute.

Ajuste o tratamento para, quando o parse falhar, montar a mensagem com o status e o começo da resposta crua:

```ts
} catch {
  setErro(
    `Resposta inesperada do servidor (HTTP ${req.status}). ` +
    `Início da resposta: ${req.responseText.slice(0, 120)}`
  );
  return;
}
```

Isso não é código temporário para jogar fora: mensagem de erro que não diz o que aconteceu é defeito de produto. Mantenha, apenas com redação apresentável.

Em paralelo, leia **Vercel → Deployments → o deploy atual → Runtime Logs**, filtrando por `/api/upload`. Se a função lançou exceção, o stack trace está lá.

### Hipótese principal: limite de corpo da Vercel

A Vercel corta requisições acima de **4,5 MB** *antes* de chamar a função — e responde com página de erro da plataforma, que não é JSON. O comportamento bate exatamente com o sintoma.

E `lib/plans.ts` declara:

```ts
free: { tamanhoMaximoBytes: 5 * MB, ... }
```

**O limite do plano gratuito (5 MB) é maior que o limite da plataforma (4,5 MB).** A interface promete 5 MB, o usuário envia 4,8 MB, a Vercel recusa antes da validação de cota, e ele recebe um erro que não explica nada.

Os planos Pro (50 MB) e Escritório (200 MB) têm o mesmo problema, de forma ainda pior.

Confirme o limite atual na documentação da Vercel antes de fixar o número — ele já mudou por plano.

### Correção esperada

1. Alinhar `lib/plans.ts` ao teto real da plataforma, com uma margem para o overhead do `multipart/form-data` (o corpo é maior que o arquivo). Sugestão: **4 MB** em todos os planos por enquanto, com a constante nomeada e comentada explicando a origem do número.
2. Refletir o novo limite em todo lugar onde ele aparece: dropzone (`.txt ou .xlsx · até 5 MB`), landing, página de planos.
3. Tratar o 413 da plataforma com mensagem própria: *"Arquivo acima do limite de X MB por envio."*
4. Registrar em `docs/DEPLOY.md` e no `CLAUDE.md` que o teto de upload é imposto pela plataforma, e que subir de verdade exige upload direto para o Storage do Supabase por signed URL (o arquivo deixa de passar pela função) — encaminhamento natural para a Fase 4, junto com a fila.

Se os Runtime Logs mostrarem outra causa — exceção no `deps.subir`, política de Storage ausente em produção, variável de ambiente faltando —, corrija a causa real e me diga que a hipótese do limite estava errada.

### Critério de aceite

- Arquivo dentro do limite sobe em produção e mostra o preview do `0000`.
- Arquivo acima do limite recebe mensagem que diz o limite e o tamanho enviado.
- Nenhum caminho de erro do upload termina em "Resposta inesperada do servidor" sem status.

---

## B1 — Cadastro: a confirmação existe, mas passa despercebida

### Sintoma relatado

"Ao clicar em 'Criar conta' a tela volta para a criação da conta e não dá nenhuma mensagem que foi enviado um e-mail."

### O que realmente acontece

A mensagem **é exibida**. `app/(auth)/acoes.ts` devolve corretamente:

```ts
if (data.user && !data.session) {
  return { aviso: 'Conta criada. Confira seu e-mail para confirmar o cadastro.' };
}
```

E o `formulario-auth.tsx` renderiza. Na captura de tela ela aparece — em `text-sm text-muted-foreground`, cinza-claro, espremida entre o campo Senha e o botão "Criar conta", enquanto os três campos voltaram a mostrar placeholder.

O usuário lê a tela inteira como "não aconteceu nada". **É um defeito de produto, não de código:** o sinal mais importante do fluxo está tipografado como nota de rodapé, e o formulário limpo comunica falha.

### Correção esperada

Trocar o retorno silencioso por um estado de sucesso inequívoco. Quando `data.user && !data.session`, **substituir o formulário** por um painel de confirmação contendo:

- Título afirmativo: *"Confirme seu e-mail"*
- O endereço para onde a mensagem foi enviada, escrito por extenso — é o que permite ao usuário perceber que digitou errado
- Instrução de conferir a caixa de spam
- Ação "Reenviar e-mail de confirmação" (ver B2)
- Link para `/login`

Aviso e erro não podem continuar com o mesmo peso visual. Sucesso e falha precisam ser distinguíveis num relance, sem ler.

### Critério de aceite

- Após cadastro bem-sucedido, o formulário sai da tela e entra a confirmação com o e-mail digitado visível.
- O estado é acessível: `role="status"` e foco movido para o painel.

---

## B2 — Recadastro com o mesmo e-mail não reenvia a confirmação

### Sintoma

Usuário criou conta, o link de confirmação expirou. Ao tentar criar conta de novo com o mesmo e-mail (`augusto.maria86@gmail.com`), **nenhum e-mail chega**. A conta fica inacessível: não confirma e não entra.

### Diagnóstico a fazer

O `signUp` do Supabase, para e-mail já cadastrado e não confirmado, tem comportamento que depende da configuração do projeto:

- Com **proteção contra enumeração de e-mail ativada** (padrão), ele devolve sucesso falso, sem enviar nada — de propósito, para não revelar quem tem conta.
- Há ainda limite de frequência de envio (rate limit) por endereço.

Confirme qual dos dois é o caso antes de mexer. **Authentication → Logs** no painel do Supabase mostra a tentativa e o motivo.

### Correção esperada

Não desligue a proteção contra enumeração — ela existe por um bom motivo e este produto guarda dado fiscal.

O caminho correto é oferecer **reenvio explícito**:

1. Ação de servidor nova, `reenviarConfirmacao(email)`, usando `supabase.auth.resend({ type: 'signup', email })`.
2. Botão no painel de confirmação do B1 e um caminho para quem já saiu da tela — link "Não recebeu o e-mail?" na `/login`.
3. Resposta **sempre igual**, tenha a conta existido ou não: *"Se houver conta com este e-mail, a mensagem foi reenviada."* Resposta diferente por caso é justamente o vazamento que a proteção evita.
4. Proteção contra abuso: intervalo mínimo entre reenvios, com mensagem dizendo quanto falta.

Documente no `CLAUDE.md`, em duas linhas, por que a resposta é deliberadamente ambígua — senão alguém "melhora" isso depois.

### Critério de aceite

- Usuário com cadastro pendente consegue receber novo e-mail de confirmação.
- A resposta da interface é idêntica para e-mail existente e inexistente.
- Reenvio em sequência é barrado com mensagem clara.

---

## B4 — "Baixar original" e "Baixar TXT" abrem o arquivo em vez de baixar

### Sintoma

O clique leva a uma aba com o conteúdo do TXT na tela (`|0000|006|0|||01122021|...`), em vez de salvar o arquivo.

### Causa identificada

`app/(app)/conversao.tsx`, em `baixarArquivo`:

```ts
const link = document.createElement('a');
link.href = corpo.url;
link.download = corpo.nome ?? '';
link.click();
```

**O atributo `download` do HTML é ignorado quando a URL é de outra origem.** A signed URL aponta para `xqhebqvnjwspmvrhmqsz.supabase.co`, e a aplicação está em `sped-contrib.vercel.app`. Como o Storage serve o TXT com `Content-Type: text/plain`, o navegador exibe em vez de baixar. O comentário no código chama isso de "download", mas o navegador nunca recebeu instrução para baixar.

### Correção esperada

Quem manda o navegador baixar é o cabeçalho `Content-Disposition: attachment`, e o Supabase Storage sabe emiti-lo: basta pedir no momento de assinar a URL.

Em `lib/api/dependencias-supabase.ts`, `createSignedUrl` aceita uma opção de download com o nome desejado do arquivo. Propague isso:

1. Estenda a assinatura de `urlAssinada` no contrato `lib/api/dependencias.ts` com um parâmetro opcional de nome para download.
2. `lib/api/download.ts` passa `arquivo.nome_original`.
3. Confirme na documentação atual do `@supabase/supabase-js` a forma exata da opção — a API mudou entre versões maiores. Não escreva de memória.
4. Atualize o fake em `tests/api/fake.ts` e escreva teste garantindo que o nome chega ao assinador.

O `link.download` do cliente pode continuar, mas deixe um comentário registrando que ele **não** é o que resolve — senão o próximo a mexer vai confiar nele de novo.

### Critério de aceite

- Clicar em "Baixar original" ou "Baixar TXT" salva o arquivo, sem abrir aba.
- O arquivo salvo tem o nome original, não o UUID do Storage.
- Vale para as três saídas: TXT original, TXT reconvertido e planilha.

---

## B5 — Planilha baixada com nome de UUID, e o arquivo de saída parece pendente

### B5.1 — Nome do arquivo

**Sintoma:** a planilha chega como `b7ad9904-1c78-4921-bc6b-d6c087238f67.xlsx`.

**Causa:** mesma raiz do B4. O objeto no Storage se chama `{uuid}.xlsx`, e sem `Content-Disposition` o navegador adota o último segmento da URL como nome.

**Esperado:** `efd_teste_202112_ajustado.xlsx` — o nome do TXT de origem, com a extensão trocada.

Confira como `lib/api/convert.ts` preenche `nome_original` do arquivo de saída. Se estiver gravando o UUID, corrija na origem: derive de `nome_original` do arquivo de entrada, trocando a extensão e mantendo qualquer sufixo (`_ajustado`). Corrigir só na hora do download deixa o dashboard mostrando UUID.

**Critério de aceite:** `efd_teste_202112.txt` → `efd_teste_202112.xlsx`, e a volta gera `efd_teste_202112_ajustado.txt`. Com teste.

### B5.2 — Arquivo convertido aparece como "Ainda não convertido"

**Sintoma relatado:** "depois de baixar o excel e sair da página, não mostra mais o arquivo convertido e é solicitado nova conversão."

**O que acontece:** a conversão não se perdeu. Ao voltar, o usuário abre a página **do arquivo de saída** — o `.xlsx`, que é uma linha própria em `arquivos`. Essa linha não tem conversão *dela*, então a tela mostra o estado vazio:

```
Ainda não convertido
Converta para TXT do PVA.
```

Correto do ponto de vista do modelo de dados, péssimo do ponto de vista de quem lê: "ainda não convertido" na tela de um arquivo que *é* o resultado de uma conversão comunica que algo se perdeu.

O `CLAUDE.md` registra que esse mesmo problema já foi resolvido **na listagem**, com o campo `gerado_por`. A página de detalhe ficou de fora.

**Correção esperada** — a informação existe, falta apresentá-la:

1. Quando o arquivo tem `gerado_por`, identificar como saída no topo: *"Planilha gerada a partir de `efd_teste_202112.txt`"*, com link para o arquivo de origem.
2. Trocar o estado vazio. Em vez de "Ainda não convertido", algo como: *"Editou a planilha? Converta de volta para TXT do PVA."* — o botão "Converter" continua, porque a ação é legítima; o que muda é o enquadramento.
3. Na origem, mostrar link para o resultado, fechando a navegação nos dois sentidos.

**Critério de aceite:** abrindo o `.xlsx` gerado, fica evidente de qual TXT ele veio; nenhuma tela chama de "não convertido" um arquivo que é resultado de conversão.

---

## Regras para esta rodada

1. **Ordem:** B3 → B1 → B2 → B4 → B5. B3 bloqueia todo o resto; B4 e B5.1 têm a mesma raiz e saem juntos.
2. **Um commit por bug**, mensagem em português no imperativo, citando o código (`Corrige B4: ...`).
3. **Nada de `lib/sped/` nesta rodada.** Todos os cinco são de aplicação, interface ou infraestrutura. Se alguma correção parecer exigir mexer no núcleo do parser, pare e explique antes.
4. **O teste de ouro continua obrigatório:** `npm run test` inteiro verde ao fim de cada bug, com `tests/sped/ouro.test.ts` incluso.
5. **Todo bug corrigido ganha teste** que falharia com o código antigo. Onde não for possível testar automaticamente (B1, que é visual), descreva o passo a passo de verificação manual.
6. **Confirme APIs externas na documentação atual** — `createSignedUrl` com download, `auth.resend`, limite de corpo da Vercel. Não escreva de memória; essas três mudaram de forma recente.
7. Ao terminar, atualize o `CLAUDE.md`: o limite real de upload, o motivo da resposta ambígua no reenvio, e a armadilha do `download` cross-origin. São três coisas que qualquer um redescobriria do zero.
