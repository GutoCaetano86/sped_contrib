// Tipos do nucleo de conversao. Ver docs/SPEC.md secao 5.1.

/** Tipo de dado do campo no guia: C = caractere, N = numerico. */
export type TipoCampo = 'C' | 'N';

export interface CampoLayout {
  num: number;
  nome: string;
  descricao: string;
  /**
   * A spec (5.1) preve 'C' | 'N'. A string vazia representa os 9 campos cujo
   * tipo a extracao do PDF nao identificou — todos em registros listados em
   * `revisao_manual`. Nao inventamos o tipo: quem consome trata '' como
   * "desconhecido" e nao valida. Sai do tipo quando F1-T3 fechar o dicionario.
   */
  tipo: TipoCampo | '';
  /** 0 = tamanho variavel. */
  tamanho: number;
  /** "*" no guia: exige exatamente `tamanho` caracteres. */
  tamanho_fixo: boolean;
  decimais: number;
  obrigatorio: boolean;
}

export interface RegistroLayout {
  registro: string;
  bloco: string;
  titulo: string;
  nivel: number | null;
  ocorrencia: string | null;
  qtd_campos: number;
  campos: CampoLayout[];
}

/** Uma linha do arquivo, ja resolvida na arvore. */
export interface NoRegistro {
  /** uuid curto, estavel dentro da conversao */
  id: string;
  paiId: string | null;
  /** "C100" */
  reg: string;
  nivel: number;
  /** posicao original no arquivo (1-based) */
  ordem: number;
  /** valores crus, SEM os pipes das pontas */
  valores: string[];
  /** n.o da linha no TXT, para mensagens de erro */
  linhaOriginal: number;
}

/**
 * Qual natureza de credito cada grupo de CFOP alimenta.
 *
 * Aprendido do TXT de origem, que o PVA aceitou, e gravado na aba _META para
 * a volta poder recalcular a base sem inventar regra fiscal. Chave:
 * `"aliquota|cfop"`. Ver lib/sped/apuracao.ts.
 */
export interface MapaAtribuicao {
  pis: Record<string, string>;
  cofins: Record<string, string>;
  /**
   * Tributos cuja base fechou com os documentos quando o Excel foi gerado.
   *
   * Só estes são recalculados na volta. A distinção importa: mapa AUSENTE é
   * planilha gerada por versão antiga, e aí não se sabe nada; mapa presente
   * com o tributo fora de `fechou` significa que o arquivo de origem já não
   * fechava, e recalcular ali zeraria bases legítimas.
   */
  fechou: ('pis' | 'cofins')[];
}

export interface ResultadoParse {
  nos: NoRegistro[];
  cabecalho: { cnpj: string; razaoSocial: string; dtIni: string; dtFin: string };
  erros: ErroValidacao[];
  avisos: ErroValidacao[];
  /** Só vem preenchido na leitura de um XLSX que trouxe o mapa na _META. */
  atribuicao?: MapaAtribuicao | null;
}

export interface ErroValidacao {
  severidade: 'erro' | 'aviso';
  linha?: number;
  aba?: string;
  registro?: string;
  campo?: string;
  mensagem: string;
}

// ---------------------------------------------------------------------------
// Dicionario de leiaute (data/layout_efd_contribuicoes.json)
// ---------------------------------------------------------------------------

/** Caracteristicas do arquivo TXT declaradas no dicionario. Ver spec 2.1. */
export interface ArquivoLayout {
  delimitador: string;
  encoding: string;
  quebra_linha: string;
  linha_inicia_e_termina_com_delimitador: boolean;
  separador_decimal: string;
  formato_data: string;
  formato_periodo: string;
  formato_hora: string;
  sem_linhas_em_branco: boolean;
}

/** Entrada do array `revisao_manual`: extracao incompleta a conferir em F1-T3. */
export interface PendenciaRevisao {
  registro: string;
  pagina_guia: number;
  campos_extraidos: number;
  motivos: string[];
}

export type MotivoIntegridade =
  | 'nome_duplicado'
  | 'tipo_nao_identificado'
  | 'num_nao_sequencial'
  | 'campo_01_nao_e_reg';

/**
 * Defeito detectado no proprio dicionario ao carregar — nao no arquivo do
 * usuario. Alimenta a conferencia de F1-T3.
 */
export interface AvisoIntegridade {
  registro: string;
  motivo: MotivoIntegridade;
  campo?: string;
  mensagem: string;
}

/** Registro do leiaute com os indices de acesso O(1) ja montados. */
export interface RegistroIndexado extends RegistroLayout {
  /**
   * Nome do campo -> campo. Em nome repetido guarda a PRIMEIRA ocorrencia;
   * a duplicata vira `AvisoIntegridade`. Ver `Layout.avisosIntegridade`.
   */
  readonly campoPorNome: ReadonlyMap<string, CampoLayout>;
  /**
   * Numero do campo -> campo. Necessario porque em 19 registros a numeracao
   * tem buracos: `campos[num - 1]` devolveria o campo errado.
   */
  readonly campoPorNum: ReadonlyMap<number, CampoLayout>;
}

/** Dicionario carregado, validado e indexado. */
export interface Layout {
  readonly layout: string;
  readonly versao_guia: string;
  readonly arquivo: ArquivoLayout;
  readonly blocos: Readonly<Record<string, string>>;
  readonly ordem_blocos: readonly string[];
  readonly total_registros: number;
  readonly total_campos: number;
  /** Codigo do registro -> registro indexado. */
  readonly registros: ReadonlyMap<string, RegistroIndexado>;
  readonly pendencias: readonly PendenciaRevisao[];
  readonly avisosIntegridade: readonly AvisoIntegridade[];
  /** O(1). `undefined` quando o registro nao existe no guia. */
  registro(cod: string): RegistroIndexado | undefined;
  /** O(1). `undefined` quando o registro ou o campo nao existe. */
  campo(cod: string, nome: string): CampoLayout | undefined;
}
