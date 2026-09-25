// GET e DELETE /api/files/[id] — o que a tela de detalhe e o polling usam.
import { describe, expect, it, vi } from 'vitest';
import { deleteArquivo, getArquivo } from '@/lib/api/arquivo';
import { arquivoFalso, conversaoFalsa, criarFake } from './fake';

const AGORA = new Date('2026-07-30T12:00:00.000Z');

describe('GET /api/files/[id]', () => {
  it('devolve o arquivo com a conversão em que ele foi origem', async () => {
    const deps = criarFake({
      agora: AGORA,
      arquivos: [arquivoFalso({ cnpj: '39189437736165', razao_social: 'EMPRESA' })],
      conversoes: [
        conversaoFalsa({
          id: 'c1',
          arquivo_origem_id: 'arq-1',
          total_linhas: 153,
          resumo_registros: [
            { reg: '0000', n: 1 },
            { reg: 'C170', n: 34 },
          ],
          avisos: [{ severidade: 'aviso', mensagem: 'algo', linha: 51 }],
        }),
      ],
    });

    const resposta = await getArquivo('arq-1', deps);
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(corpo).toMatchObject({ arquivo_id: 'arq-1', cnpj: '39189437736165' });
    expect(corpo.ultima_conversao.total_linhas).toBe(153);
    // A tela de detalhe precisa da lista INTEIRA, não do corte da listagem.
    expect(corpo.ultima_conversao.resumo_registros).toHaveLength(2);
    expect(corpo.ultima_conversao.avisos).toHaveLength(1);
  });

  it('a conversão que interessa é aquela em que o arquivo foi origem', async () => {
    // Um XLSX de saída também aparece como `arquivo_saida_id` de outra
    // conversão; mostrar essa no lugar traria o resumo do arquivo errado.
    const deps = criarFake({
      agora: AGORA,
      arquivos: [arquivoFalso({ id: 'saida', tipo: 'xlsx' })],
      conversoes: [
        conversaoFalsa({
          id: 'gerou',
          arquivo_origem_id: 'outro',
          arquivo_saida_id: 'saida',
          criado_em: '2026-07-30T11:00:00.000Z',
        }),
        conversaoFalsa({
          id: 'usou',
          arquivo_origem_id: 'saida',
          direcao: 'xlsx_para_txt',
          criado_em: '2026-07-30T10:00:00.000Z',
        }),
      ],
    });

    const corpo = await (await getArquivo('saida', deps)).json();
    expect(corpo.ultima_conversao.conversao_id).toBe('usou');
    // Mas as duas continuam disponíveis.
    expect(corpo.conversoes).toHaveLength(2);
  });

  it('arquivo sem conversão devolve ultima_conversao e gerado_por nulos', async () => {
    const deps = criarFake({ agora: AGORA, arquivos: [arquivoFalso()] });
    const corpo = await (await getArquivo('arq-1', deps)).json();
    expect(corpo.ultima_conversao).toBeNull();
    expect(corpo.gerado_por).toBeNull();
  });

  it('arquivo que é saída de conversão devolve gerado_por (B5.2)', async () => {
    // Antes disto a tela de detalhe da própria saída mostrava "Ainda não
    // convertido", porque so `arquivo_origem_id` era considerado.
    const deps = criarFake({
      agora: AGORA,
      arquivos: [
        arquivoFalso({ id: 'origem', nome_original: 'efd_202112.txt' }),
        arquivoFalso({ id: 'saida', tipo: 'xlsx', nome_original: 'efd_202112.xlsx' }),
      ],
      conversoes: [
        conversaoFalsa({ id: 'gerou', arquivo_origem_id: 'origem', arquivo_saida_id: 'saida' }),
      ],
    });

    const corpo = await (await getArquivo('saida', deps)).json();
    expect(corpo.ultima_conversao).toBeNull();
    expect(corpo.gerado_por).toMatchObject({
      conversao_id: 'gerou',
      arquivo_origem_id: 'origem',
      arquivo_origem_nome: 'efd_202112.txt',
    });
  });

  it('arquivo de outro usuário responde 404, e não 403', async () => {
    const deps = criarFake({
      agora: AGORA,
      arquivos: [arquivoFalso({ id: 'alheio', user_id: 'user-2' })],
    });
    const resposta = await getArquivo('alheio', deps);
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe('Arquivo não encontrado.');
  });

  it('exige sessão', async () => {
    const deps = criarFake({ usuario: null, arquivos: [arquivoFalso()] });
    expect((await getArquivo('arq-1', deps)).status).toBe(401);
  });
});

describe('DELETE /api/files/[id]', () => {
  it('remove do Storage e do banco', async () => {
    const deps = criarFake({ agora: AGORA, arquivos: [arquivoFalso()] });
    deps.storage.set('uploads/user-1/arq-1.txt', Buffer.from('conteudo'));

    const resposta = await deleteArquivo('arq-1', deps);
    expect(resposta.status).toBe(200);
    expect(deps.storage.has('uploads/user-1/arq-1.txt')).toBe(false);
    expect(deps.banco.arquivos).toHaveLength(0);
  });

  it('não deixa apagar arquivo de outro usuário', async () => {
    const alheio = arquivoFalso({
      id: 'alheio',
      user_id: 'user-2',
      storage_path: 'uploads/user-2/alheio.txt',
    });
    const deps = criarFake({ agora: AGORA, arquivos: [alheio] });
    deps.storage.set('uploads/user-2/alheio.txt', Buffer.from('conteudo'));

    const resposta = await deleteArquivo('alheio', deps);
    expect(resposta.status).toBe(404);
    expect(deps.storage.has('uploads/user-2/alheio.txt')).toBe(true);
    expect(deps.banco.arquivos).toHaveLength(1);
  });

  it('falha no Storage não apaga a linha do banco', async () => {
    // Ordem deliberada: Storage primeiro. Se o banco fosse primeiro, uma falha
    // aqui deixaria um objeto órfão no bucket — invisível e cobrado.
    const deps = criarFake({ agora: AGORA, arquivos: [arquivoFalso()] });
    deps.remover = async () => {
      throw new Error('storage fora do ar');
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await deleteArquivo('arq-1', deps);
    expect(resposta.status).toBe(500);
    expect(deps.banco.arquivos).toHaveLength(1);
    log.mockRestore();
  });

  it('exige sessão', async () => {
    const deps = criarFake({ usuario: null, arquivos: [arquivoFalso()] });
    expect((await deleteArquivo('arq-1', deps)).status).toBe(401);
  });
});
