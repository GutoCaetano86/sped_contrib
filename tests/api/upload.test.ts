// POST /api/upload — spec 6. Ver tests/api/fake.ts para o armazem falso.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postUpload } from '@/lib/api/upload';
import { PLANOS } from '@/lib/plans';
import { criarFake, requisicaoUpload } from './fake';

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('POST /api/upload — caminho feliz', () => {
  it('aceita o TXT, sobe para uploads/{user_id}/ e insere em arquivos', async () => {
    const deps = criarFake();
    const bytes = fixture('efd_minimo.txt');

    const resposta = await postUpload(requisicaoUpload('efd_202112.txt', bytes), deps);
    expect(resposta.status).toBe(201);

    const corpo = await resposta.json();
    expect(corpo).toMatchObject({
      nome: 'efd_202112.txt',
      tamanho_bytes: bytes.length,
      tipo: 'txt',
    });
    expect(corpo.arquivo_id).toBeTruthy();

    // O prefixo {user_id}/ e o que a politica de Storage exige (F3-T1).
    expect(deps.subidas).toHaveLength(1);
    expect(deps.subidas[0]!.bucket).toBe('uploads');
    expect(deps.subidas[0]!.caminho).toMatch(/^user-1\/.+\.txt$/);

    const registro = deps.banco.arquivos[0]!;
    expect(registro.storage_path).toMatch(/^uploads\/user-1\//);
    expect(registro.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extrai CNPJ, razao social e periodo do registro 0000', async () => {
    const deps = criarFake();
    await postUpload(requisicaoUpload('efd.txt', fixture('efd_minimo.txt')), deps);

    const registro = deps.banco.arquivos[0]!;
    expect(registro.cnpj).toMatch(/^\d{14}$/);
    expect(registro.razao_social).toBeTruthy();
    // ddmmaaaa do leiaute vira aaaa-mm-dd, que e o tipo `date` do Postgres.
    expect(registro.periodo_inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(registro.periodo_fim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('aceita XLSX pela assinatura de ZIP', async () => {
    const deps = criarFake();
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);

    const resposta = await postUpload(requisicaoUpload('planilha.xlsx', zip, XLSX_MIME), deps);
    expect(resposta.status).toBe(201);
    expect((await resposta.json()).tipo).toBe('xlsx');
    // Sem 0000 para ler; os metadados so aparecem na conversao.
    expect(deps.banco.arquivos[0]!.cnpj).toBeNull();
  });
});

describe('POST /api/upload — arquivo grande demais', () => {
  it('recusa com 413 acima do limite do plano', async () => {
    const deps = criarFake({ plano: 'free' });
    const grande = Buffer.alloc(PLANOS.free.tamanhoMaximoBytes + 1);
    grande.write('|0000|', 0, 'latin1');

    const resposta = await postUpload(requisicaoUpload('grande.txt', grande), deps);

    expect(resposta.status).toBe(413);
    const { erro } = await resposta.json();
    expect(erro).toContain('5 MB');
    expect(erro).toContain('Gratuito');
    // Nada pode ter subido nem entrado no banco.
    expect(deps.subidas).toHaveLength(0);
    expect(deps.banco.arquivos).toHaveLength(0);
  });

  it('o mesmo arquivo passa no plano pro', async () => {
    const deps = criarFake({ plano: 'pro' });
    const seisMb = Buffer.alloc(6 * 1024 * 1024);
    seisMb.write('|0000|', 0, 'latin1');

    const resposta = await postUpload(requisicaoUpload('media.txt', seisMb), deps);
    expect(resposta.status).toBe(201);
  });

  it('recusa pelo content-length antes de bufferizar o corpo', async () => {
    // Um upload de 300 MB nao pode chegar a `request.formData()`.
    const deps = criarFake({ plano: 'free' });
    const requisicao = new Request('http://localhost/api/upload', {
      method: 'POST',
      headers: { 'content-length': String(300 * 1024 * 1024) },
      body: 'nem chega a ser lido',
    });

    const resposta = await postUpload(requisicao, deps);
    expect(resposta.status).toBe(413);
  });
});

describe('POST /api/upload — validacoes', () => {
  it('exige sessao', async () => {
    const deps = criarFake({ usuario: null });
    const resposta = await postUpload(requisicaoUpload('efd.txt', '|0000|x|'), deps);
    expect(resposta.status).toBe(401);
    expect((await resposta.json()).erro).toBe('Não autenticado.');
  });

  it('recusa extensao fora de .txt e .xlsx', async () => {
    const deps = criarFake();
    const resposta = await postUpload(requisicaoUpload('planilha.csv', '|0000|x|'), deps);
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('csv');
  });

  it('recusa TXT que nao comeca com |0000|', async () => {
    const deps = criarFake();
    const resposta = await postUpload(requisicaoUpload('qualquer.txt', 'nada a ver\r\n'), deps);
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('|0000|');
  });

  it('aceita TXT com BOM, que o parser remove depois', async () => {
    const deps = criarFake();
    const comBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('|0000|006|0|||01122021|31122021|EMPRESA|11111111000191|RS|4314902|||1|\r\n'),
    ]);
    const resposta = await postUpload(requisicaoUpload('bom.txt', comBom), deps);
    expect(resposta.status).toBe(201);
  });

  it('recusa .xlsx que nao e ZIP', async () => {
    const deps = criarFake();
    const resposta = await postUpload(
      requisicaoUpload('falso.xlsx', 'isto e texto puro', XLSX_MIME),
      deps,
    );
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('ZIP');
  });

  it('recusa MIME incompativel com a extensao', async () => {
    const deps = criarFake();
    const resposta = await postUpload(
      requisicaoUpload('efd.txt', '|0000|x|', 'image/png'),
      deps,
    );
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('image/png');
  });

  it('recusa arquivo vazio', async () => {
    const deps = criarFake();
    const resposta = await postUpload(requisicaoUpload('vazio.txt', ''), deps);
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('vazio');
  });

  it('recusa corpo sem o campo "arquivo"', async () => {
    const deps = criarFake();
    const form = new FormData();
    form.append('outro', 'coisa');
    const resposta = await postUpload(
      new Request('http://localhost/api/upload', { method: 'POST', body: form }),
      deps,
    );
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('arquivo');
  });
});
