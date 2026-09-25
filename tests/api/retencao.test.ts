// Job de retenção. Ver lib/api/retencao.ts.
//
// É o único código que apaga dado de todos os usuários e roda sem sessão, então
// o que estes testes travam é sobretudo o que ele NÃO pode fazer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bucket } from '@/lib/api/dependencias';
import {
  executarRetencao,
  segredoConfere,
  type ArquivoVencido,
  type DependenciasRetencao,
} from '@/lib/api/retencao';

const AGORA = new Date('2026-08-01T04:00:00.000Z');
const SEGREDO = 'segredo-de-teste';

const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString();

interface ArquivoFalso extends ArquivoVencido {
  criado_em: string;
}

function criarDeps(
  perfis: { id: string; plano: string }[],
  arquivos: ArquivoFalso[],
  objetos: Record<string, { nome: string; criadoEm: string }[]> = {},
): DependenciasRetencao & {
  removidos: { bucket: Bucket; caminhos: string[] }[];
  apagados: string[];
} {
  const removidos: { bucket: Bucket; caminhos: string[] }[] = [];
  const apagados: string[] = [];
  return {
    removidos,
    apagados,
    planosDosUsuarios: async () => perfis,
    arquivosAte: async (userId, limite) =>
      arquivos.filter((a) => a.user_id === userId && new Date(a.criado_em) < limite),
    removerObjetos: async (bucket, caminhos) => {
      removidos.push({ bucket, caminhos });
    },
    listarObjetos: async (_bucket, prefixo) => objetos[prefixo] ?? [],
    caminhosRegistrados: async (userId) =>
      arquivos.filter((a) => a.user_id === userId).map((a) => a.storage_path),
    apagarArquivos: async (ids) => {
      apagados.push(...ids);
    },
    agora: () => AGORA,
  };
}

const pedir = (query = '', segredo: string | null = SEGREDO) =>
  new Request(`http://localhost/api/cron/retencao${query}`, {
    headers: segredo === null ? {} : { authorization: `Bearer ${segredo}` },
  });

beforeEach(() => {
  process.env.CRON_SECRET = SEGREDO;
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('autorização', () => {
  it('recusa sem o segredo', async () => {
    const deps = criarDeps([], []);
    const r = await executarRetencao(pedir('', null), deps);
    expect(r.status).toBe(401);
    expect(deps.apagados).toEqual([]);
  });

  it('recusa com segredo errado', async () => {
    const deps = criarDeps([], []);
    expect((await executarRetencao(pedir('', 'outro'), deps)).status).toBe(401);
  });

  it('fica FECHADA quando CRON_SECRET não está configurada', async () => {
    // Modo permissivo por engano de configuração seria pior: qualquer um
    // apagaria os arquivos de todo mundo.
    delete process.env.CRON_SECRET;
    expect(segredoConfere(pedir())).toBe(false);
    expect((await executarRetencao(pedir(), criarDeps([], []))).status).toBe(401);
  });
});

describe('quem vence, por plano', () => {
  const perfis = [
    { id: 'u-free', plano: 'free' },
    { id: 'u-pro', plano: 'pro' },
    { id: 'u-esc', plano: 'escritorio' },
  ];

  it('respeita a retenção de cada plano', async () => {
    const arquivos: ArquivoFalso[] = [
      // free = 1 dia
      { id: 'f-velho', user_id: 'u-free', storage_path: 'uploads/u-free/a.txt', criado_em: diasAtras(2) },
      { id: 'f-novo', user_id: 'u-free', storage_path: 'uploads/u-free/b.txt', criado_em: diasAtras(0.5) },
      // pro = 30 dias
      { id: 'p-velho', user_id: 'u-pro', storage_path: 'uploads/u-pro/a.txt', criado_em: diasAtras(31) },
      { id: 'p-novo', user_id: 'u-pro', storage_path: 'uploads/u-pro/b.txt', criado_em: diasAtras(29) },
      // escritorio = 90 dias
      { id: 'e-novo', user_id: 'u-esc', storage_path: 'uploads/u-esc/a.txt', criado_em: diasAtras(89) },
    ];
    const deps = criarDeps(perfis, arquivos);

    const corpo = await (await executarRetencao(pedir(), deps)).json();

    expect(deps.apagados.sort()).toEqual(['f-velho', 'p-velho']);
    expect(corpo.arquivos).toBe(2);
    expect(corpo.por_plano).toEqual({ free: 1, pro: 1 });
  });

  it('plano desconhecido cai no mais restritivo, e não no mais permissivo', async () => {
    // limitesDe() devolve o gratuito para valor inválido. Se caísse no maior,
    // um perfil corrompido guardaria arquivo por 90 dias sem ninguém notar.
    const deps = criarDeps(
      [{ id: 'u-x', plano: 'plano-que-nao-existe' }],
      [{ id: 'x1', user_id: 'u-x', storage_path: 'uploads/u-x/a.txt', criado_em: diasAtras(2) }],
    );
    await executarRetencao(pedir(), deps);
    expect(deps.apagados).toEqual(['x1']);
  });

  it('sem nada vencido não chama o Storage', async () => {
    const deps = criarDeps(
      [{ id: 'u-pro', plano: 'pro' }],
      [{ id: 'novo', user_id: 'u-pro', storage_path: 'uploads/u-pro/a.txt', criado_em: diasAtras(1) }],
    );
    const corpo = await (await executarRetencao(pedir(), deps)).json();
    expect(corpo.arquivos).toBe(0);
    expect(deps.removidos).toEqual([]);
    expect(deps.apagados).toEqual([]);
  });
});

describe('execução', () => {
  const perfis = [{ id: 'u1', plano: 'free' }];
  const arquivos: ArquivoFalso[] = [
    { id: 'a1', user_id: 'u1', storage_path: 'uploads/u1/entrada.txt', criado_em: diasAtras(5) },
    { id: 'a2', user_id: 'u1', storage_path: 'outputs/u1/saida.xlsx', criado_em: diasAtras(5) },
  ];

  it('separa por bucket e tira o prefixo do caminho', async () => {
    const deps = criarDeps(perfis, arquivos);
    await executarRetencao(pedir(), deps);

    const porBucket = Object.fromEntries(deps.removidos.map((r) => [r.bucket, r.caminhos]));
    expect(porBucket.uploads).toEqual(['u1/entrada.txt']);
    expect(porBucket.outputs).toEqual(['u1/saida.xlsx']);
  });

  it('simular relata sem apagar', async () => {
    const deps = criarDeps(perfis, arquivos);
    const corpo = await (await executarRetencao(pedir('?simular=1'), deps)).json();

    expect(corpo.simulacao).toBe(true);
    expect(corpo.arquivos).toBe(2);
    expect(corpo.por_bucket).toEqual({ uploads: 1, outputs: 1 });
    expect(deps.removidos).toEqual([]);
    expect(deps.apagados).toEqual([]);
  });

  it('falha no Storage não apaga a linha do banco', async () => {
    // Ordem deliberada: se o banco fosse primeiro, uma falha aqui deixaria
    // objeto órfão no bucket — invisível e cobrado.
    const deps = criarDeps(perfis, arquivos);
    deps.removerObjetos = async () => {
      throw new Error('storage fora do ar');
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await executarRetencao(pedir(), deps);

    expect(resposta.status).toBe(500);
    expect(deps.apagados).toEqual([]);
    log.mockRestore();
  });

  it('varre órfão: objeto no Storage sem linha em arquivos', async () => {
    // O upload direto grava no Storage ANTES de a linha existir. Se o usuário
    // abandona entre o PUT e a confirmação, sobra objeto invisível — e a
    // /privacidade promete que tudo é apagado no prazo do plano.
    const deps = criarDeps(
      [{ id: 'u1', plano: 'free' }],
      [{ id: 'a1', user_id: 'u1', storage_path: 'uploads/u1/registrado.txt', criado_em: diasAtras(0) }],
      {
        u1: [
          { nome: 'registrado.txt', criadoEm: diasAtras(0) },
          { nome: 'abandonado.txt', criadoEm: diasAtras(3) },
        ],
      },
    );

    const corpo = await (await executarRetencao(pedir(), deps)).json();

    expect(corpo.orfaos).toBe(1);
    const removidos = deps.removidos.flatMap((r) => r.caminhos);
    expect(removidos).toContain('u1/abandonado.txt');
    // O que tem dono não pode ser tocado.
    expect(removidos).not.toContain('u1/registrado.txt');
  });

  it('respeita a carência de 24 h — envio em andamento não é apagado', async () => {
    const deps = criarDeps(
      [{ id: 'u1', plano: 'free' }],
      [],
      { u1: [{ nome: 'enviando-agora.txt', criadoEm: diasAtras(0.2) }] },
    );

    const corpo = await (await executarRetencao(pedir(), deps)).json();

    expect(corpo.orfaos).toBe(0);
    expect(deps.removidos).toEqual([]);
  });

  it('simular conta os órfãos sem apagá-los', async () => {
    const deps = criarDeps(
      [{ id: 'u1', plano: 'free' }],
      [],
      { u1: [{ nome: 'abandonado.txt', criadoEm: diasAtras(3) }] },
    );

    const corpo = await (await executarRetencao(pedir('?simular=1'), deps)).json();

    expect(corpo.orfaos).toBe(1);
    expect(deps.removidos).toEqual([]);
  });

  it('não registra conteúdo nem caminho de arquivo no log', async () => {
    // Spec 8: log leva identificador e métrica, nunca dado fiscal.
    const deps = criarDeps(perfis, arquivos);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await executarRetencao(pedir(), deps);

    const registrado = log.mock.calls.flat().join(' ');
    expect(registrado).toContain('2');
    expect(registrado).not.toContain('entrada.txt');
    expect(registrado).not.toContain('u1/');
    log.mockRestore();
  });
});
