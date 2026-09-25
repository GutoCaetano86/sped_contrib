// Contrato de dependencias das rotas de API (F3-T3). Ver docs/SPEC.md secao 6.
//
// Por que existe: os handlers em lib/api/*.ts recebem `Dependencias` em vez de
// chamarem o Supabase direto. Assim o criterio de aceite do F3-T3 — teste de
// integracao de caminho feliz, cota esgotada, arquivo grande e acesso a
// arquivo de outro usuario — roda no Vitest, que e puro e offline, exercitando
// Request e Response de verdade.
//
// A implementacao real esta em dependencias-supabase.ts e e o unico modulo
// desta pasta que importa Supabase.

export type TipoArquivo = 'txt' | 'xlsx';
export type Direcao = 'txt_para_xlsx' | 'xlsx_para_txt';
export type StatusConversao = 'pendente' | 'processando' | 'concluido' | 'erro';

/** Os dois buckets privados criados na F3-T1. */
export type Bucket = 'uploads' | 'outputs';

/** Linha da tabela `arquivos` (spec 4). */
export interface RegistroArquivo {
  id: string;
  user_id: string;
  nome_original: string;
  tipo: TipoArquivo;
  tamanho_bytes: number;
  storage_path: string;
  hash_sha256: string | null;
  cnpj: string | null;
  razao_social: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  criado_em: string;
}

/** Linha da tabela `conversoes` (spec 4). */
export interface RegistroConversao {
  id: string;
  user_id: string;
  arquivo_origem_id: string;
  arquivo_saida_id: string | null;
  direcao: Direcao;
  status: StatusConversao;
  total_linhas: number | null;
  total_registros: number | null;
  erros: unknown[];
  avisos: unknown[];
  /** Contagem por tipo de registro, para a tabela de conferência (spec 7.4). */
  resumo_registros: { reg: string; n: number }[];
  duracao_ms: number | null;
  criado_em: string;
  concluido_em: string | null;
}

export type NovoArquivo = Omit<RegistroArquivo, 'id' | 'criado_em'>;

export interface Dependencias {
  /** Usuario da sessao, ou `null` se nao houver. */
  usuario(): Promise<{ id: string } | null>;

  /** Plano do perfil. Valor desconhecido cai no `free` em `limitesDe`. */
  plano(userId: string): Promise<string>;

  /** Conversoes criadas pelo usuario a partir de `desde`, inclusive. */
  contarConversoes(userId: string, desde: Date): Promise<number>;

  inserirArquivo(dados: NovoArquivo): Promise<RegistroArquivo>;

  /**
   * Arquivo por id, SEM filtrar por usuario.
   *
   * Deliberado: quem confere o dono e o handler, com uma comparacao explicita.
   * A RLS ja bloqueia isso no banco, mas depender so dela deixaria a regra
   * sem teste — e uma checagem no codigo e a segunda camada que o criterio de
   * aceite exige.
   */
  obterArquivo(id: string): Promise<RegistroArquivo | null>;

  /** Apaga o arquivo do banco. O objeto no Storage sai por `remover`. */
  apagarArquivo(id: string): Promise<void>;

  /** Remove o objeto do Storage. Ausente nao e erro: o alvo e o mesmo. */
  remover(bucket: Bucket, caminho: string): Promise<void>;

  /** Pagina de arquivos do usuario, mais recentes primeiro, e o total. */
  listarArquivos(
    userId: string,
    inicio: number,
    quantidade: number,
  ): Promise<{ itens: RegistroArquivo[]; total: number }>;

  /** Conversoes que citam algum dos arquivos, para achar a ultima de cada um. */
  conversoesDeArquivos(userId: string, arquivoIds: string[]): Promise<RegistroConversao[]>;

  /** Conversoes em que o arquivo foi origem OU saida, mais recentes primeiro. */
  conversoesDoArquivo(userId: string, arquivoId: string): Promise<RegistroConversao[]>;

  criarConversao(dados: {
    user_id: string;
    arquivo_origem_id: string;
    direcao: Direcao;
    status: StatusConversao;
  }): Promise<RegistroConversao>;

  atualizarConversao(id: string, dados: Partial<RegistroConversao>): Promise<void>;

  subir(bucket: Bucket, caminho: string, bytes: Buffer, contentType: string): Promise<void>;

  /**
   * URL para o NAVEGADOR enviar o arquivo direto ao Storage.
   *
   * Existe porque a Vercel corta requisicao acima de 4.500.000 bytes antes de
   * chamar a funcao (medido em producao, ver docs/BUGS-POS-DEPLOY.md B3). Um
   * TXT de EFD tem 17 MB, entao passar o arquivo pelo corpo da requisicao
   * simplesmente nao funciona. Com a URL assinada o arquivo vai do navegador
   * para o Supabase, e a funcao so recebe o caminho.
   */
  assinarUpload(bucket: Bucket, caminho: string): Promise<{ url: string; token: string }>;
  baixar(bucket: Bucket, caminho: string): Promise<Buffer>;

  /**
   * `nomeParaDownload`, quando informado, pede `Content-Disposition: attachment`
   * ao Storage (spec 6 / B4). Sem ele a URL assinada e cross-origin — o
   * atributo `download` do `<a>` no cliente e ignorado pelo navegador nesse
   * caso, e o Storage serve TXT como `text/plain`, que abre em vez de baixar.
   */
  urlAssinada(
    bucket: Bucket,
    caminho: string,
    segundos: number,
    nomeParaDownload?: string,
  ): Promise<string>;

  /** Injetados para o teste ser deterministico. */
  novoId(): string;
  agora(): Date;
}

/** Bucket a partir do caminho gravado em `storage_path`. */
export function bucketDoCaminho(caminho: string): Bucket {
  return caminho.startsWith('outputs/') ? 'outputs' : 'uploads';
}

/** `storage_path` sem o nome do bucket, que e o que a API do Storage espera. */
export function caminhoNoBucket(caminho: string): string {
  return caminho.replace(/^(uploads|outputs)\//, '');
}
