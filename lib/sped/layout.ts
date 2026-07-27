// Loader tipado do dicionario de leiaute (data/layout_efd_contribuicoes.json).
// Ver docs/SPEC.md secoes 2.4 e 5.1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  AvisoIntegridade,
  CampoLayout,
  Layout,
  RegistroIndexado,
  RegistroLayout,
} from './types';

/**
 * Falha estrutural do dicionario que acompanha a aplicacao. Diferente do
 * parser — que nunca lanca por conteudo do usuario —, aqui lancar e correto:
 * dicionario quebrado e bug nosso, e seguir adiante geraria TXT invalido.
 */
export class ErroLayoutInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroLayoutInvalido';
  }
}

const CampoSchema = z.object({
  num: z.number().int().positive(),
  nome: z.string().min(1),
  descricao: z.string(),
  // '' cobre os 9 campos sem tipo identificado na extracao. Ver types.ts.
  tipo: z.union([z.literal('C'), z.literal('N'), z.literal('')]),
  tamanho: z.number().int().nonnegative(),
  tamanho_fixo: z.boolean(),
  decimais: z.number().int().nonnegative(),
  obrigatorio: z.boolean(),
});

const RegistroSchema = z.object({
  registro: z.string().length(4),
  bloco: z.string().min(1),
  titulo: z.string(),
  nivel: z.number().int().nullable(),
  ocorrencia: z.string().nullable(),
  qtd_campos: z.number().int().nonnegative(),
  campos: z.array(CampoSchema),
});

const ArquivoSchema = z.object({
  delimitador: z.string(),
  encoding: z.string(),
  quebra_linha: z.string(),
  linha_inicia_e_termina_com_delimitador: z.boolean(),
  separador_decimal: z.string(),
  formato_data: z.string(),
  formato_periodo: z.string(),
  formato_hora: z.string(),
  sem_linhas_em_branco: z.boolean(),
});

const PendenciaSchema = z.object({
  registro: z.string(),
  pagina_guia: z.number().int(),
  campos_extraidos: z.number().int(),
  motivos: z.array(z.string()),
});

const DicionarioSchema = z.object({
  layout: z.literal('EFD-Contribuicoes'),
  versao_guia: z.string().min(1),
  arquivo: ArquivoSchema,
  blocos: z.record(z.string(), z.string()),
  ordem_blocos: z.array(z.string()),
  total_registros: z.number().int().positive(),
  total_campos: z.number().int().positive(),
  revisao_manual: z.array(PendenciaSchema),
  registros: z.record(z.string(), RegistroSchema),
});

/** Caminho padrao do dicionario, relativo a raiz do projeto. */
export const CAMINHO_PADRAO_LAYOUT = join('data', 'layout_efd_contribuicoes.json');

/**
 * Indexa um registro e acumula os defeitos encontrados.
 *
 * Os avisos nao interrompem a carga: o dicionario tem pendencias conhecidas
 * (ver `revisao_manual` e a tarefa F1-T3) e o produto precisa rodar com elas
 * enquanto nao sao fechadas.
 */
function indexarRegistro(
  registro: RegistroLayout,
  avisos: AvisoIntegridade[],
): RegistroIndexado {
  const campoPorNome = new Map<string, CampoLayout>();
  const campoPorNum = new Map<number, CampoLayout>();

  for (const campo of registro.campos) {
    const jaVisto = campoPorNome.get(campo.nome);
    if (jaVisto) {
      avisos.push({
        registro: registro.registro,
        motivo: 'nome_duplicado',
        campo: campo.nome,
        mensagem:
          `Campo "${campo.nome}" aparece nos numeros ${jaVisto.num} e ${campo.num}. ` +
          `O indice por nome guarda o ${jaVisto.num}; o ${campo.num} fica inacessivel por nome.`,
      });
    } else {
      campoPorNome.set(campo.nome, campo);
    }

    campoPorNum.set(campo.num, campo);

    if (campo.tipo === '') {
      avisos.push({
        registro: registro.registro,
        motivo: 'tipo_nao_identificado',
        campo: campo.nome,
        mensagem: `Campo ${campo.num} "${campo.nome}" sem tipo C/N identificado na extracao do guia.`,
      });
    }
  }

  const numeracaoSequencial = registro.campos.every((c, i) => c.num === i + 1);
  if (!numeracaoSequencial) {
    const numeros = registro.campos.map((c) => c.num).join(',');
    avisos.push({
      registro: registro.registro,
      motivo: 'num_nao_sequencial',
      mensagem: `Numeracao de campos com buracos: [${numeros}].`,
    });
  }

  const primeiro = registro.campos[0];
  if (primeiro && primeiro.nome !== 'REG') {
    avisos.push({
      registro: registro.registro,
      motivo: 'campo_01_nao_e_reg',
      campo: primeiro.nome,
      mensagem: `Campo 01 deveria ser REG, veio "${primeiro.nome}".`,
    });
  }

  return { ...registro, campoPorNome, campoPorNum };
}

/**
 * Le, valida e indexa o dicionario de leiaute.
 *
 * Lanca `ErroLayoutInvalido` se o arquivo nao existir, nao for JSON valido,
 * divergir do schema ou contradizer os proprios totais declarados.
 */
export function carregarLayout(caminho: string = CAMINHO_PADRAO_LAYOUT): Layout {
  const absoluto = join(process.cwd(), caminho);

  let bruto: string;
  try {
    bruto = readFileSync(absoluto, 'utf-8');
  } catch (causa) {
    throw new ErroLayoutInvalido(
      `Nao foi possivel ler o dicionario de leiaute em ${absoluto}: ${String(causa)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch (causa) {
    throw new ErroLayoutInvalido(`Dicionario de leiaute nao e JSON valido: ${String(causa)}`);
  }

  const analise = DicionarioSchema.safeParse(json);
  if (!analise.success) {
    const detalhes = analise.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ErroLayoutInvalido(`Dicionario de leiaute fora do schema — ${detalhes}`);
  }
  const dicionario = analise.data;

  const avisosIntegridade: AvisoIntegridade[] = [];
  const registros = new Map<string, RegistroIndexado>();

  for (const [codigo, registro] of Object.entries(dicionario.registros)) {
    if (codigo !== registro.registro) {
      throw new ErroLayoutInvalido(
        `Chave "${codigo}" nao bate com o campo registro "${registro.registro}".`,
      );
    }
    if (registro.qtd_campos !== registro.campos.length) {
      throw new ErroLayoutInvalido(
        `Registro ${codigo}: qtd_campos = ${registro.qtd_campos} mas ha ${registro.campos.length} campos.`,
      );
    }
    registros.set(codigo, indexarRegistro(registro, avisosIntegridade));
  }

  // Os totais declarados sao a defesa contra edicao parcial do dicionario:
  // quem fechar F1-T3 e esquecer de atualiza-los recebe erro imediato.
  if (registros.size !== dicionario.total_registros) {
    throw new ErroLayoutInvalido(
      `total_registros declara ${dicionario.total_registros}, mas ha ${registros.size} registros.`,
    );
  }
  const somaCampos = [...registros.values()].reduce((soma, r) => soma + r.campos.length, 0);
  if (somaCampos !== dicionario.total_campos) {
    throw new ErroLayoutInvalido(
      `total_campos declara ${dicionario.total_campos}, mas a soma dos campos e ${somaCampos}.`,
    );
  }

  return {
    layout: dicionario.layout,
    versao_guia: dicionario.versao_guia,
    arquivo: dicionario.arquivo,
    blocos: dicionario.blocos,
    ordem_blocos: dicionario.ordem_blocos,
    total_registros: dicionario.total_registros,
    total_campos: dicionario.total_campos,
    registros,
    pendencias: dicionario.revisao_manual,
    avisosIntegridade,
    registro: (cod) => registros.get(cod),
    campo: (cod, nome) => registros.get(cod)?.campoPorNome.get(nome),
  };
}

/**
 * Cache de processo. O dicionario tem ~455 KB e nao muda em runtime; reler e
 * revalidar a cada requisicao seria desperdicio.
 */
const cache = new Map<string, Layout>();

/** `carregarLayout` memoizado por caminho. */
export function obterLayout(caminho: string = CAMINHO_PADRAO_LAYOUT): Layout {
  const emCache = cache.get(caminho);
  if (emCache) return emCache;

  const layout = carregarLayout(caminho);
  cache.set(caminho, layout);
  return layout;
}

/** Descarta o cache. Existe para os testes; nao usar em runtime. */
export function limparCacheLayout(): void {
  cache.clear();
}
