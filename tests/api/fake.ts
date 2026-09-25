// Dependencias falsas para os testes das rotas (F3-T3).
//
// Decisao importante: este armazem NAO filtra por usuario. Em producao a RLS
// filtra, mas se o fake tambem filtrasse, o teste de "acesso a arquivo de
// outro usuario" estaria testando o fake, e nao o handler. Como esta, o teste
// so passa se o handler comparar o `user_id` explicitamente.
import type {
  Bucket,
  Dependencias,
  NovoArquivo,
  RegistroArquivo,
  RegistroConversao,
  StatusConversao,
} from '@/lib/api/dependencias';

export interface OpcoesFake {
  /** Usuario da sessao; `null` simula requisicao sem sessao. */
  usuario?: { id: string } | null;
  plano?: string;
  /** Momento fixo, para a cota mensal e o rate limit serem deterministicos. */
  agora?: Date;
  arquivos?: RegistroArquivo[];
  conversoes?: RegistroConversao[];
  /** Faz `urlAssinada` falhar, como quando o objeto ja foi apagado. */
  assinaturaFalha?: boolean;
}

export interface Fake extends Dependencias {
  /** Estado observavel pelos testes. */
  readonly banco: {
    arquivos: RegistroArquivo[];
    conversoes: RegistroConversao[];
  };
  readonly storage: Map<string, Buffer>;
  /** Chamadas a `subir`, na ordem. */
  readonly subidas: { bucket: Bucket; caminho: string; bytes: number }[];
  /** Chamadas a `assinarUpload`, na ordem. */
  readonly assinados: { bucket: Bucket; caminho: string }[];
  /** Grava bytes direto, simulando o PUT do navegador para o Storage. */
  gravarComoNavegador(caminho: string, bytes: Buffer): void;
}

const ISO = (d: Date) => d.toISOString();

export function arquivoFalso(dados: Partial<RegistroArquivo> = {}): RegistroArquivo {
  return {
    id: 'arq-1',
    user_id: 'user-1',
    nome_original: 'efd.txt',
    tipo: 'txt',
    tamanho_bytes: 100,
    storage_path: 'uploads/user-1/arq-1.txt',
    hash_sha256: null,
    cnpj: null,
    razao_social: null,
    periodo_inicio: null,
    periodo_fim: null,
    criado_em: '2026-07-30T10:00:00.000Z',
    ...dados,
  };
}

export function conversaoFalsa(dados: Partial<RegistroConversao> = {}): RegistroConversao {
  return {
    id: 'conv-1',
    user_id: 'user-1',
    arquivo_origem_id: 'arq-1',
    arquivo_saida_id: null,
    direcao: 'txt_para_xlsx',
    status: 'concluido' as StatusConversao,
    total_linhas: 10,
    total_registros: 4,
    erros: [],
    avisos: [],
    resumo_registros: [],
    duracao_ms: 120,
    criado_em: '2026-07-30T10:05:00.000Z',
    concluido_em: '2026-07-30T10:05:01.000Z',
    ...dados,
  };
}

export function criarFake(opcoes: OpcoesFake = {}): Fake {
  const usuario = opcoes.usuario === undefined ? { id: 'user-1' } : opcoes.usuario;
  const agora = opcoes.agora ?? new Date('2026-07-30T12:00:00.000Z');

  const banco = {
    arquivos: [...(opcoes.arquivos ?? [])],
    conversoes: [...(opcoes.conversoes ?? [])],
  };
  const storage = new Map<string, Buffer>();
  const subidas: Fake['subidas'] = [];
  const assinados: Fake['assinados'] = [];

  let sequencia = 0;
  const proximoId = () => `id-${String(++sequencia).padStart(4, '0')}`;

  const chave = (bucket: Bucket, caminho: string) => `${bucket}/${caminho}`;

  return {
    banco,
    storage,
    subidas,
    assinados,

    // O navegador envia direto ao Storage; nos testes isso vira uma escrita
    // no mapa, sem passar por `subir`.
    gravarComoNavegador(caminho, bytes) {
      storage.set(`uploads/${caminho.replace(/^uploads\//, '')}`, bytes);
    },

    usuario: async () => usuario,
    plano: async () => opcoes.plano ?? 'free',

    contarConversoes: async (userId, desde) =>
      banco.conversoes.filter((c) => c.user_id === userId && c.criado_em >= ISO(desde)).length,

    inserirArquivo: async (dados: NovoArquivo) => {
      const registro: RegistroArquivo = { id: proximoId(), criado_em: ISO(agora), ...dados };
      banco.arquivos.push(registro);
      return registro;
    },

    // Sem filtro por usuario, de proposito. Ver o comentario no topo.
    obterArquivo: async (id) => banco.arquivos.find((a) => a.id === id) ?? null,

    apagarArquivo: async (id) => {
      banco.arquivos = banco.arquivos.filter((a) => a.id !== id);
    },

    remover: async (bucket, caminho) => {
      storage.delete(chave(bucket, caminho));
    },

    conversoesDoArquivo: async (userId, arquivoId) =>
      banco.conversoes
        .filter(
          (c) =>
            c.user_id === userId &&
            (c.arquivo_origem_id === arquivoId || c.arquivo_saida_id === arquivoId),
        )
        .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1)),

    listarArquivos: async (userId, inicio, quantidade) => {
      const meus = banco.arquivos
        .filter((a) => a.user_id === userId)
        .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));
      return { itens: meus.slice(inicio, inicio + quantidade), total: meus.length };
    },

    conversoesDeArquivos: async (userId, ids) =>
      banco.conversoes.filter(
        (c) =>
          c.user_id === userId &&
          (ids.includes(c.arquivo_origem_id) ||
            (c.arquivo_saida_id !== null && ids.includes(c.arquivo_saida_id))),
      ),

    criarConversao: async (dados) => {
      const registro: RegistroConversao = {
        id: proximoId(),
        arquivo_saida_id: null,
        total_linhas: null,
        total_registros: null,
        erros: [],
        avisos: [],
        resumo_registros: [],
        duracao_ms: null,
        criado_em: ISO(agora),
        concluido_em: null,
        ...dados,
      };
      banco.conversoes.push(registro);
      return registro;
    },

    atualizarConversao: async (id, dados) => {
      const atual = banco.conversoes.find((c) => c.id === id);
      if (!atual) throw new Error(`conversao ${id} nao existe no fake`);
      Object.assign(atual, dados);
    },

    assinarUpload: async (bucket, caminho) => {
      assinados.push({ bucket, caminho });
      return {
        url: `https://fake.supabase/upload/sign/${bucket}/${caminho}?token=tok`,
        token: 'tok',
      };
    },

    subir: async (bucket, caminho, bytes) => {
      subidas.push({ bucket, caminho, bytes: bytes.length });
      storage.set(chave(bucket, caminho), bytes);
    },

    baixar: async (bucket, caminho) => {
      const bytes = storage.get(chave(bucket, caminho));
      if (!bytes) throw new Error(`objeto ${chave(bucket, caminho)} nao existe no fake`);
      return bytes;
    },

    urlAssinada: async (bucket, caminho, segundos, nomeParaDownload) => {
      if (opcoes.assinaturaFalha) throw new Error('objeto ausente');
      const download = nomeParaDownload ? `&download=${encodeURIComponent(nomeParaDownload)}` : '';
      return `https://fake.supabase/${bucket}/${caminho}?expira=${segundos}${download}`;
    },

    novoId: proximoId,
    agora: () => agora,
  };
}

/** Request multipart com um arquivo, como o navegador manda. */
export function requisicaoUpload(
  nome: string,
  conteudo: Buffer | string,
  tipoMime = 'text/plain',
): Request {
  const bytes = typeof conteudo === 'string' ? Buffer.from(conteudo, 'latin1') : conteudo;
  const form = new FormData();
  form.append('arquivo', new File([new Uint8Array(bytes)], nome, { type: tipoMime }));
  return new Request('http://localhost/api/upload', { method: 'POST', body: form });
}

export function requisicaoJson(url: string, corpo: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}
