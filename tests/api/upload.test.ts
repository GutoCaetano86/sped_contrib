// Upload em dois passos — spec 6 e docs/BUGS-POS-DEPLOY.md B3.
//
// O caminho antigo mandava o arquivo no corpo de um POST e morria em produção:
// a Vercel corta acima de 4.500.000 bytes ANTES de chamar a função. Agora o
// navegador envia direto ao Storage e a função só assina e confere.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postAssinarUpload, postConfirmarUpload } from '@/lib/api/upload';
import { PLANOS } from '@/lib/plans';
import { criarFake, requisicaoJson } from './fake';

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);

const assinar = (corpo: unknown) =>
  requisicaoJson('http://localhost/api/upload/assinar', corpo);
const confirmar = (corpo: unknown) =>
  requisicaoJson('http://localhost/api/upload/confirmar', corpo);

/** Faz o ciclo inteiro: assina, "envia" pelo navegador, confirma. */
async function cicloCompleto(
  deps: ReturnType<typeof criarFake>,
  nome: string,
  bytes: Buffer,
) {
  const assinatura = await (
    await postAssinarUpload(assinar({ nome, tamanho_bytes: bytes.length }), deps)
  ).json();
  deps.gravarComoNavegador(assinatura.caminho, bytes);
  const resposta = await postConfirmarUpload(confirmar({ caminho: assinatura.caminho, nome }), deps);
  return { assinatura, resposta };
}

describe('passo 1 — assinar', () => {
  it('devolve URL do Storage e caminho sob o prefixo do usuário', async () => {
    const deps = criarFake();
    const resposta = await postAssinarUpload(
      assinar({ nome: 'efd.txt', tamanho_bytes: 5421 }),
      deps,
    );

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.url).toContain('upload/sign');
    expect(corpo.caminho).toMatch(/^uploads\/user-1\/.+\.txt$/);
    expect(corpo.tipo).toBe('txt');
    // O prefixo {user_id}/ é o que a política de Storage exige (F3-T1).
    expect(deps.assinados[0]!.caminho).toMatch(/^user-1\//);
  });

  it('recusa acima do limite do plano antes de qualquer envio', async () => {
    const deps = criarFake({ plano: 'free' });
    const resposta = await postAssinarUpload(
      assinar({ nome: 'grande.txt', tamanho_bytes: PLANOS.free.tamanhoMaximoBytes + 1 }),
      deps,
    );

    expect(resposta.status).toBe(413);
    expect((await resposta.json()).erro).toContain('5 MB');
    expect(deps.assinados).toHaveLength(0);
  });

  it('o limite do plano continua valendo — o teto da plataforma não se aplica mais', async () => {
    // 17 MB é o tamanho do arquivo real do projeto. Ele passa no plano pro
    // porque os bytes não trafegam pela função.
    const deps = criarFake({ plano: 'pro' });
    const resposta = await postAssinarUpload(
      assinar({ nome: 'efd_real.txt', tamanho_bytes: 17_067_032 }),
      deps,
    );
    expect(resposta.status).toBe(200);
  });

  it('recusa extensão fora de .txt e .xlsx, e arquivo vazio', async () => {
    const deps = criarFake();
    for (const corpo of [
      { nome: 'planilha.csv', tamanho_bytes: 10 },
      { nome: 'efd.txt', tamanho_bytes: 0 },
    ]) {
      expect((await postAssinarUpload(assinar(corpo), deps)).status).toBe(400);
    }
    expect(deps.assinados).toHaveLength(0);
  });

  it('exige sessão', async () => {
    const deps = criarFake({ usuario: null });
    const r = await postAssinarUpload(assinar({ nome: 'a.txt', tamanho_bytes: 1 }), deps);
    expect(r.status).toBe(401);
  });
});

describe('passo 3 — confirmar', () => {
  it('registra o arquivo e devolve o cabeçalho do 0000', async () => {
    const deps = criarFake();
    const bytes = fixture('efd_minimo.txt');
    const { resposta } = await cicloCompleto(deps, 'efd_202112.txt', bytes);

    expect(resposta.status).toBe(201);
    const corpo = await resposta.json();
    expect(corpo).toMatchObject({ nome: 'efd_202112.txt', tipo: 'txt', tamanho_bytes: bytes.length });
    expect(corpo.cabecalho.cnpj).toMatch(/^\d{14}$/);
    expect(corpo.cabecalho.periodo_inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const registro = deps.banco.arquivos[0]!;
    expect(registro.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(registro.storage_path).toMatch(/^uploads\/user-1\//);
  });

  it('aceita XLSX pela assinatura de ZIP', async () => {
    const deps = criarFake();
    const { resposta } = await cicloCompleto(deps, 'planilha.xlsx', ZIP);
    expect(resposta.status).toBe(201);
    expect((await resposta.json()).tipo).toBe('xlsx');
  });

  it('BLOQUEIA caminho de outro usuário', async () => {
    // Sem esta checagem, alguém confirmaria objeto alheio e ganharia uma linha
    // em `arquivos` apontando para o arquivo de outra conta.
    const deps = criarFake();
    deps.gravarComoNavegador('uploads/user-2/roubado.txt', fixture('efd_minimo.txt'));

    const resposta = await postConfirmarUpload(
      confirmar({ caminho: 'uploads/user-2/roubado.txt', nome: 'roubado.txt' }),
      deps,
    );

    expect(resposta.status).toBe(400);
    expect(deps.banco.arquivos).toHaveLength(0);
  });

  it('BLOQUEIA travessia de caminho', async () => {
    const deps = criarFake();
    const resposta = await postConfirmarUpload(
      confirmar({ caminho: 'uploads/user-1/../user-2/a.txt', nome: 'a.txt' }),
      deps,
    );
    expect(resposta.status).toBe(400);
  });

  it('revalida o TAMANHO real, e não o declarado na assinatura', async () => {
    // O cliente declara um tamanho no passo 1 e envia outro no passo 2. Quem
    // manda é o que está no Storage.
    const deps = criarFake({ plano: 'free' });
    const assinatura = await (
      await postAssinarUpload(assinar({ nome: 'mentira.txt', tamanho_bytes: 10 }), deps)
    ).json();

    const grande = Buffer.alloc(PLANOS.free.tamanhoMaximoBytes + 1);
    grande.write('|0000|', 0, 'latin1');
    deps.gravarComoNavegador(assinatura.caminho, grande);

    const resposta = await postConfirmarUpload(
      confirmar({ caminho: assinatura.caminho, nome: 'mentira.txt' }),
      deps,
    );

    expect(resposta.status).toBe(413);
    expect(deps.banco.arquivos).toHaveLength(0);
    // E o objeto recusado não pode ficar ocupando o bucket.
    expect(deps.storage.has(assinatura.caminho)).toBe(false);
  });

  it('recusa TXT que não começa com |0000| e apaga o objeto', async () => {
    const deps = criarFake();
    const { assinatura, resposta } = await cicloCompleto(
      deps,
      'qualquer.txt',
      Buffer.from('nada a ver\r\n', 'latin1'),
    );

    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('|0000|');
    expect(deps.storage.has(assinatura.caminho)).toBe(false);
  });

  it('recusa .xlsx que não é ZIP', async () => {
    const deps = criarFake();
    const { resposta } = await cicloCompleto(deps, 'falso.xlsx', Buffer.from('texto puro'));
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('ZIP');
  });

  it('objeto ausente responde 404 em vez de estourar', async () => {
    const deps = criarFake();
    const resposta = await postConfirmarUpload(
      confirmar({ caminho: 'uploads/user-1/nunca-enviado.txt', nome: 'a.txt' }),
      deps,
    );
    expect(resposta.status).toBe(404);
  });

  it('exige sessão', async () => {
    const deps = criarFake({ usuario: null });
    const r = await postConfirmarUpload(
      confirmar({ caminho: 'uploads/user-1/a.txt', nome: 'a.txt' }),
      deps,
    );
    expect(r.status).toBe(401);
  });
});
