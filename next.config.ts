import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

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

export default nextConfig;
