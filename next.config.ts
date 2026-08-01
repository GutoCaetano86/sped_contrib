import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const raizDoProjeto = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Existe um package-lock.json solto em C:\Users\augus\; sem isto o Next
  // infere a home do usuario como raiz do workspace e o rastreamento de
  // arquivos do build sai errado.
  outputFileTracingRoot: raizDoProjeto,

  // O dicionario de leiaute e lido do disco em runtime pelas rotas de API.
  // Ver lib/sped/layout.ts (tarefa F1-T2).
  outputFileTracingIncludes: {
    '/api/convert': ['./data/**'],
  },
};

// Sem SENTRY_AUTH_TOKEN o wrapper so instrumenta e nao sobe source map, que e
// o caso em desenvolvimento e em clone novo. Ver lib/observabilidade.ts para o
// filtro que impede conteudo fiscal de sair.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Source map sobe para o Sentry e some do bundle publico: sem isto o codigo
  // do servidor ficaria legivel para qualquer um.
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Encaminha os eventos do navegador por uma rota do proprio dominio, para
  // bloqueador de anuncio nao engolir o monitoramento.
  tunnelRoute: '/monitoring',

  disableLogger: true,
});
