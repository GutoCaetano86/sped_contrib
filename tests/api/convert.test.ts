// POST /api/convert — spec 6.
//
// Estes testes rodam o pipeline de verdade: parseTxt -> gerarExcel -> Storage.
// Nao ha mock de lib/sped/, so das dependencias de infraestrutura.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { postConvert } from '@/lib/api/convert';
import { CONVERSOES_POR_HORA, PLANOS } from '@/lib/plans';
import { carregarLayout } from '@/lib/sped/layout';
import { parseTxt } from '@/lib/sped/parser';
import { gerarExcel } from '@/lib/sped/to-excel';
import { arquivoFalso, conversaoFalsa, criarFake, requisicaoJson } from './fake';

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));

const AGORA = new Date('2026-07-30T12:00:00.000Z');
const pedir = (corpo: unknown) => requisicaoJson('http://localhost/api/convert', corpo);

/** Fake com um TXT ja no Storage, pronto para converter. */
function comTxt(nome = 'efd_minimo.txt', opcoes: Parameters<typeof criarFake>[0] = {}) {
  const bytes = fixture(nome);
  const arquivo = arquivoFalso({
    id: 'arq-txt',
    nome_original: nome,
    tipo: 'txt',
    tamanho_bytes: bytes.length,
    storage_path: 'uploads/user-1/arq-txt.txt',
  });
  const deps = criarFake({ agora: AGORA, arquivos: [arquivo], ...opcoes });
  deps.storage.set('uploads/user-1/arq-txt.txt', bytes);
  return { deps, bytes, arquivo };
}

describe('POST /api/convert — caminho feliz', () => {
  it('converte TXT em XLSX, grava em outputs/ e fecha a conversao', async () => {
    const { deps } = comTxt();

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(corpo.status).toBe('concluido');
    expect(corpo.total_linhas).toBeGreaterThan(0);
    expect(corpo.total_registros).toBeGreaterThan(0);
    expect(corpo.arquivo_saida_id).toBeTruthy();
    expect(corpo.erros).toEqual([]);

    // A saida foi para o bucket outputs, sob o prefixo do usuario.
    const subida = deps.subidas.at(-1)!;
    expect(subida.bucket).toBe('outputs');
    expect(subida.caminho).toMatch(/^user-1\/.+\.xlsx$/);

    // E e um XLSX de verdade: assinatura de ZIP.
    const gravado = deps.storage.get(`outputs/${subida.caminho}`)!;
    expect(gravado.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const conversao = deps.banco.conversoes.at(-1)!;
    expect(conversao.status).toBe('concluido');
    expect(conversao.arquivo_saida_id).toBe(corpo.arquivo_saida_id);
    expect(conversao.duracao_ms).toBeGreaterThanOrEqual(0);
    expect(conversao.concluido_em).toBe(AGORA.toISOString());
  });

  it('o arquivo de saida herda CNPJ, razao social e periodo do 0000', async () => {
    const { deps } = comTxt();
    await postConvert(pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }), deps);

    const saida = deps.banco.arquivos.at(-1)!;
    expect(saida.tipo).toBe('xlsx');
    expect(saida.nome_original).toBe('efd_minimo.xlsx');
    expect(saida.cnpj).toMatch(/^\d{14}$/);
    expect(saida.periodo_inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a volta XLSX -> TXT devolve o arquivo byte a byte e nao sobrescreve o original', async () => {
    // O teste de ouro ja prova o round-trip; aqui o que se prova e que a rota
    // encadeia os modulos na ordem certa e grava um arquivo novo.
    const layout = carregarLayout();
    const original = fixture('efd_reduzido.txt');
    const xlsx = await gerarExcel(parseTxt(original, layout), layout);

    const arquivo = arquivoFalso({
      id: 'arq-xlsx',
      nome_original: 'efd_reduzido.xlsx',
      tipo: 'xlsx',
      tamanho_bytes: xlsx.length,
      storage_path: 'uploads/user-1/arq-xlsx.xlsx',
    });
    const deps = criarFake({ agora: AGORA, arquivos: [arquivo] });
    deps.storage.set('uploads/user-1/arq-xlsx.xlsx', xlsx);

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-xlsx', direcao: 'xlsx_para_txt' }),
      deps,
    );
    expect(resposta.status).toBe(200);

    const subida = deps.subidas.at(-1)!;
    expect(deps.storage.get(`outputs/${subida.caminho}`)!.equals(original)).toBe(true);

    const saida = deps.banco.arquivos.at(-1)!;
    expect(saida.nome_original).toBe('efd_reduzido_ajustado.txt');
    expect(saida.storage_path).not.toBe(arquivo.storage_path);
  });

  it('erro nao bloqueia TXT -> XLSX: o usuario corrige na planilha', async () => {
    // Assimetria da spec 11, decisoes 6 e 7.
    const { deps } = comTxt('efd_com_erros.txt');

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.status).toBe('concluido');
    expect(corpo.total_erros).toBeGreaterThan(0);
    expect(corpo.arquivo_saida_id).toBeTruthy();
  });
});

describe('POST /api/convert — cota esgotada', () => {
  it('recusa com 429 quando a cota do mes acabou', async () => {
    const usadas = Array.from({ length: PLANOS.free.conversoesPorMes }, (_, i) =>
      conversaoFalsa({ id: `usada-${i}`, criado_em: '2026-07-02T08:00:00.000Z' }),
    );
    const { deps } = comTxt('efd_minimo.txt', { plano: 'free', conversoes: usadas });

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );

    expect(resposta.status).toBe(429);
    const corpo = await resposta.json();
    expect(corpo.erro).toContain('Cota do plano Gratuito esgotada');
    expect(corpo.detalhes).toMatchObject({ limite_mensal: 3, conversoes_no_mes: 3 });
    // Nao pode criar conversao nem gastar processamento.
    expect(deps.banco.conversoes).toHaveLength(usadas.length);
    expect(deps.subidas).toHaveLength(0);
  });

  it('conversao do mes passado nao conta na cota do mes corrente', async () => {
    const antigas = Array.from({ length: 10 }, (_, i) =>
      conversaoFalsa({ id: `antiga-${i}`, criado_em: '2026-06-15T08:00:00.000Z' }),
    );
    const { deps } = comTxt('efd_minimo.txt', { plano: 'free', conversoes: antigas });

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );
    expect(resposta.status).toBe(200);
  });

  it('recusa com 429 no rate limit de 10 por hora, mesmo com cota mensal sobrando', async () => {
    // Spec 8: o limite horario independe do plano.
    const recentes = Array.from({ length: CONVERSOES_POR_HORA }, (_, i) =>
      conversaoFalsa({ id: `recente-${i}`, criado_em: '2026-07-30T11:30:00.000Z' }),
    );
    const { deps } = comTxt('efd_minimo.txt', {
      plano: 'escritorio',
      conversoes: recentes,
    });

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );

    expect(resposta.status).toBe(429);
    expect((await resposta.json()).erro).toContain('por hora');
  });

  it('conversao de duas horas atras nao conta no rate limit', async () => {
    const antigas = Array.from({ length: CONVERSOES_POR_HORA }, (_, i) =>
      conversaoFalsa({ id: `antiga-${i}`, criado_em: '2026-07-30T09:00:00.000Z' }),
    );
    const { deps } = comTxt('efd_minimo.txt', { plano: 'pro', conversoes: antigas });

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );
    expect(resposta.status).toBe(200);
  });
});

describe('POST /api/convert — arquivo de outro usuario', () => {
  it('responde 404, e nao 403, para nao confirmar que o id existe', async () => {
    const alheio = arquivoFalso({
      id: 'arq-alheio',
      user_id: 'user-2',
      storage_path: 'uploads/user-2/arq-alheio.txt',
    });
    const deps = criarFake({ agora: AGORA, arquivos: [alheio] });
    deps.storage.set('uploads/user-2/arq-alheio.txt', fixture('efd_minimo.txt'));

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-alheio', direcao: 'txt_para_xlsx' }),
      deps,
    );

    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe('Arquivo não encontrado.');
    // O conteudo do arquivo alheio nao pode ter sido nem lido.
    expect(deps.banco.conversoes).toHaveLength(0);
    expect(deps.subidas).toHaveLength(0);
  });

  it('id inexistente responde igual a arquivo alheio', async () => {
    const { deps } = comTxt();
    const resposta = await postConvert(
      pedir({ arquivo_id: 'nao-existe', direcao: 'txt_para_xlsx' }),
      deps,
    );
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).erro).toBe('Arquivo não encontrado.');
  });
});

describe('POST /api/convert — validacoes e falhas', () => {
  it('exige sessao', async () => {
    const { deps } = comTxt('efd_minimo.txt', { usuario: null });
    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );
    expect(resposta.status).toBe(401);
  });

  it('recusa corpo sem arquivo_id ou com direcao invalida', async () => {
    const { deps } = comTxt();
    for (const corpo of [{}, { arquivo_id: 'arq-txt', direcao: 'txt_para_pdf' }]) {
      const resposta = await postConvert(pedir(corpo), deps);
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).erro).toBe('Corpo inválido.');
    }
  });

  it('recusa corpo que nao e JSON', async () => {
    const { deps } = comTxt();
    const resposta = await postConvert(
      new Request('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ isto nao e json',
      }),
      deps,
    );
    expect(resposta.status).toBe(400);
  });

  it('recusa direcao que nao bate com o tipo do arquivo', async () => {
    const { deps } = comTxt();
    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'xlsx_para_txt' }),
      deps,
    );
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).erro).toContain('exige arquivo .xlsx');
  });

  it('erro BLOQUEIA XLSX -> TXT e a conversao fica com status erro', async () => {
    // Planilha sem a aba _META: o contrato de reconversao nao existe.
    const layout = carregarLayout();
    const semMeta = await (async () => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('C100').addRow(['_id', '_ordem', 'REG']);
      return Buffer.from(await wb.xlsx.writeBuffer());
    })();
    expect(layout).toBeDefined();

    const arquivo = arquivoFalso({
      id: 'arq-ruim',
      nome_original: 'sem_meta.xlsx',
      tipo: 'xlsx',
      storage_path: 'uploads/user-1/arq-ruim.xlsx',
    });
    const deps = criarFake({ agora: AGORA, arquivos: [arquivo] });
    deps.storage.set('uploads/user-1/arq-ruim.xlsx', semMeta);

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-ruim', direcao: 'xlsx_para_txt' }),
      deps,
    );

    expect(resposta.status).toBe(422);
    const corpo = await resposta.json();
    expect(corpo.status).toBe('erro');
    expect(corpo.arquivo_saida_id).toBeNull();
    expect(corpo.total_erros).toBeGreaterThan(0);
    // Nada foi gravado no Storage: gerar TXT que o PVA recusa e pior que nao gerar.
    expect(deps.subidas).toHaveLength(0);
    expect(deps.banco.conversoes.at(-1)!.status).toBe('erro');
  });

  it('falha de infraestrutura nao deixa a conversao presa em processando', async () => {
    const { deps } = comTxt();
    // Objeto sumiu do Storage entre o insert e a conversao.
    deps.storage.clear();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await postConvert(
      pedir({ arquivo_id: 'arq-txt', direcao: 'txt_para_xlsx' }),
      deps,
    );

    expect(resposta.status).toBe(500);
    expect(deps.banco.conversoes.at(-1)!.status).toBe('erro');
    // Spec 8: nunca registrar conteudo de arquivo em log.
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
