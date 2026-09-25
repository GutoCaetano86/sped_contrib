// GET /api/download/[id] — spec 6: signed URL com validade de 5 minutos.
import { describe, expect, it, vi } from 'vitest';
import { VALIDADE_SEGUNDOS, getDownload } from '@/lib/api/download';
import { arquivoFalso, criarFake } from './fake';

const AGORA = new Date('2026-07-30T12:00:00.000Z');

describe('GET /api/download/[id]', () => {
  it('devolve signed URL com validade de 5 minutos', async () => {
    const deps = criarFake({ agora: AGORA, arquivos: [arquivoFalso()] });

    const resposta = await getDownload('arq-1', deps);
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(VALIDADE_SEGUNDOS).toBe(300);
    expect(corpo.url).toContain('uploads/user-1/arq-1.txt');
    expect(corpo.url).toContain('expira=300');
    expect(corpo.expira_em).toBe('2026-07-30T12:05:00.000Z');
    expect(corpo).toMatchObject({ arquivo_id: 'arq-1', nome: 'efd.txt', tipo: 'txt' });
  });

  it('pede Content-Disposition com o nome original (B4)', async () => {
    // Sem isso a URL assinada e cross-origin: o atributo `download` do <a> no
    // cliente e ignorado e o Storage serve TXT como text/plain, que abre em
    // vez de baixar.
    const deps = criarFake({ agora: AGORA, arquivos: [arquivoFalso({ nome_original: 'efd_202112.txt' })] });

    const corpo = await (await getDownload('arq-1', deps)).json();
    expect(corpo.url).toContain(`download=${encodeURIComponent('efd_202112.txt')}`);
  });

  it('assina no bucket outputs quando o arquivo e de saida', async () => {
    const saida = arquivoFalso({
      id: 'arq-saida',
      tipo: 'xlsx',
      storage_path: 'outputs/user-1/arq-saida.xlsx',
    });
    const deps = criarFake({ agora: AGORA, arquivos: [saida] });

    const corpo = await (await getDownload('arq-saida', deps)).json();
    expect(corpo.url).toContain('/outputs/user-1/arq-saida.xlsx');
  });

  it('arquivo de outro usuario responde 404, e nao 403', async () => {
    const alheio = arquivoFalso({ id: 'arq-alheio', user_id: 'user-2' });
    const deps = criarFake({ agora: AGORA, arquivos: [alheio] });

    const resposta = await getDownload('arq-alheio', deps);
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe('Arquivo não encontrado.');
  });

  it('id inexistente responde igual a arquivo alheio', async () => {
    const deps = criarFake({ agora: AGORA });
    const resposta = await getDownload('nao-existe', deps);
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe('Arquivo não encontrado.');
  });

  it('exige sessao', async () => {
    const deps = criarFake({ usuario: null, arquivos: [arquivoFalso()] });
    expect((await getDownload('arq-1', deps)).status).toBe(401);
  });

  it('objeto ja apagado pela retencao responde 410', async () => {
    const deps = criarFake({
      agora: AGORA,
      arquivos: [arquivoFalso()],
      assinaturaFalha: true,
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await getDownload('arq-1', deps);
    expect(resposta.status).toBe(410);
    expect((await resposta.json()).erro).toContain('não está mais disponível');
    log.mockRestore();
  });
});
