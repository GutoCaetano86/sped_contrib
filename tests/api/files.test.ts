// GET /api/files — spec 6: lista paginada de arquivos e conversoes.
import { describe, expect, it } from 'vitest';
import { getFiles } from '@/lib/api/files';
import { arquivoFalso, conversaoFalsa, criarFake } from './fake';

const AGORA = new Date('2026-07-30T12:00:00.000Z');
const pedir = (query = '') => new Request(`http://localhost/api/files${query}`);

/** Tres arquivos do user-1 e um do user-2, com datas crescentes. */
function tresArquivos() {
  return [
    arquivoFalso({ id: 'a1', criado_em: '2026-07-28T10:00:00.000Z', nome_original: 'um.txt' }),
    arquivoFalso({ id: 'a2', criado_em: '2026-07-29T10:00:00.000Z', nome_original: 'dois.txt' }),
    arquivoFalso({ id: 'a3', criado_em: '2026-07-30T10:00:00.000Z', nome_original: 'tres.txt' }),
    arquivoFalso({ id: 'alheio', user_id: 'user-2', criado_em: '2026-07-30T11:00:00.000Z' }),
  ];
}

describe('GET /api/files — caminho feliz', () => {
  it('lista so os arquivos do usuario, mais recentes primeiro', async () => {
    const deps = criarFake({ agora: AGORA, arquivos: tresArquivos() });

    const resposta = await getFiles(pedir(), deps);
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(corpo.total).toBe(3);
    expect(corpo.arquivos.map((a: { arquivo_id: string }) => a.arquivo_id)).toEqual([
      'a3',
      'a2',
      'a1',
    ]);
    expect(corpo.pagina).toBe(1);
    expect(corpo.por_pagina).toBe(20);
  });

  it('cada arquivo leva a ultima conversao, que e o status do dashboard', async () => {
    const deps = criarFake({
      agora: AGORA,
      arquivos: tresArquivos(),
      conversoes: [
        conversaoFalsa({
          id: 'c-velha',
          arquivo_origem_id: 'a1',
          status: 'erro',
          criado_em: '2026-07-28T11:00:00.000Z',
        }),
        conversaoFalsa({
          id: 'c-nova',
          arquivo_origem_id: 'a1',
          status: 'concluido',
          arquivo_saida_id: 'saida-1',
          criado_em: '2026-07-28T12:00:00.000Z',
        }),
      ],
    });

    const corpo = await (await getFiles(pedir(), deps)).json();
    const a1 = corpo.arquivos.find((a: { arquivo_id: string }) => a.arquivo_id === 'a1');

    expect(a1.ultima_conversao).toMatchObject({
      conversao_id: 'c-nova',
      status: 'concluido',
      arquivo_saida_id: 'saida-1',
    });
    // Arquivo nunca convertido nao inventa status.
    const a2 = corpo.arquivos.find((a: { arquivo_id: string }) => a.arquivo_id === 'a2');
    expect(a2.ultima_conversao).toBeNull();
  });

  it('traz a cota do plano para a barra do dashboard', async () => {
    const deps = criarFake({
      agora: AGORA,
      plano: 'pro',
      arquivos: tresArquivos(),
      conversoes: [
        conversaoFalsa({ id: 'c1', criado_em: '2026-07-10T10:00:00.000Z' }),
        conversaoFalsa({ id: 'c2', criado_em: '2026-07-11T10:00:00.000Z' }),
        // Do mes passado: nao pode entrar na conta.
        conversaoFalsa({ id: 'c0', criado_em: '2026-06-11T10:00:00.000Z' }),
      ],
    });

    const corpo = await (await getFiles(pedir(), deps)).json();
    expect(corpo.cota).toMatchObject({
      plano: 'Pro',
      conversoes_no_mes: 2,
      limite_mensal: 50,
      restantes: 48,
    });
  });

  it('pagina', async () => {
    const deps = criarFake({ agora: AGORA, arquivos: tresArquivos() });

    const primeira = await (await getFiles(pedir('?pagina=1&por_pagina=2'), deps)).json();
    expect(primeira.arquivos.map((a: { arquivo_id: string }) => a.arquivo_id)).toEqual(['a3', 'a2']);
    expect(primeira.total_paginas).toBe(2);

    const segunda = await (await getFiles(pedir('?pagina=2&por_pagina=2'), deps)).json();
    expect(segunda.arquivos.map((a: { arquivo_id: string }) => a.arquivo_id)).toEqual(['a1']);
  });

  it('lista vazia nao quebra', async () => {
    const deps = criarFake({ agora: AGORA });
    const corpo = await (await getFiles(pedir(), deps)).json();
    expect(corpo).toMatchObject({ total: 0, total_paginas: 1, arquivos: [], conversoes: [] });
  });
});

describe('GET /api/files — isolamento e validacao', () => {
  it('nunca devolve arquivo ou conversao de outro usuario', async () => {
    const deps = criarFake({
      agora: AGORA,
      arquivos: tresArquivos(),
      conversoes: [
        conversaoFalsa({ id: 'minha', arquivo_origem_id: 'a1' }),
        conversaoFalsa({ id: 'alheia', user_id: 'user-2', arquivo_origem_id: 'alheio' }),
      ],
    });

    const corpo = await (await getFiles(pedir('?por_pagina=100'), deps)).json();
    const texto = JSON.stringify(corpo);
    expect(texto).not.toContain('user-2');
    expect(texto).not.toContain('alheio');
    expect(corpo.conversoes.map((c: { conversao_id: string }) => c.conversao_id)).toEqual(['minha']);
  });

  it('exige sessao', async () => {
    const deps = criarFake({ usuario: null });
    expect((await getFiles(pedir(), deps)).status).toBe(401);
  });

  it('recusa paginacao invalida', async () => {
    const deps = criarFake({ agora: AGORA });
    for (const query of ['?pagina=0', '?pagina=-1', '?por_pagina=500', '?pagina=abc']) {
      const resposta = await getFiles(pedir(query), deps);
      expect(resposta.status, query).toBe(400);
    }
  });
});
