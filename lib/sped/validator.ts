// Validacoes de tipo, tamanho e obrigatoriedade. Ver docs/SPEC.md secao 5.7.
//
// A mesma funcao serve as duas direcoes da conversao, mas o efeito difere
// (spec 11, decisoes 6 e 7): em TXT -> XLSX o erro NAO bloqueia, porque o
// usuario quer justamente ver e corrigir na planilha; em XLSX -> TXT o erro
// bloqueia, porque gerar arquivo que o PVA recusa e pior que nao gerar.
import type { ErroValidacao, Layout, NoRegistro } from './types';

export interface ResultadoValidacao {
  erros: ErroValidacao[];
  avisos: ErroValidacao[];
}

/** Campo de data no formato ddmmaaaa: por convencao, prefixo DT_ e 8 posicoes. */
const ehCampoData = (nome: string, tamanho: number): boolean =>
  nome.startsWith('DT_') && tamanho === 8;

/**
 * Digito verificador de CNPJ, aceitando o formato ALFANUMERICO.
 *
 * Os 12 primeiros caracteres podem ser letra maiuscula ou digito; os 2
 * ultimos sao sempre numericos. O calculo usa o codigo ASCII menos 48, o que
 * faz o algoritmo do CNPJ puramente numerico ser um caso particular deste:
 * '0'..'9' viram 0..9 e 'A'..'Z' viram 17..42.
 */
export function cnpjValido(valor: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(valor)) return false;
  // Sequencia toda igual passa na conta mas nao existe na vida real.
  if (/^(.)\1{13}$/.test(valor)) return false;

  const peso = (i: number) => valor.charCodeAt(i) - 48;
  const digito = (ate: number, pesos: readonly number[]): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += peso(i) * (pesos[i] ?? 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = digito(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(valor[12]) && d2 === Number(valor[13]);
}

/** Digito verificador de CPF. */
export function cpfValido(valor: string): boolean {
  if (!/^\d{11}$/.test(valor)) return false;
  if (/^(\d)\1{10}$/.test(valor)) return false;

  const d = [...valor].map(Number);
  const digito = (ate: number, pesoInicial: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += (d[i] ?? 0) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9, 10) === d[9] && digito(10, 11) === d[10];
}

/** CNPJ que tem letra: so existe no formato novo, alfanumerico. */
const ehCnpjAlfanumerico = (valor: string): boolean =>
  valor.length === 14 && /[A-Z]/.test(valor) && /^[0-9A-Z]{12}\d{2}$/.test(valor);

/** Data ddmmaaaa realmente existente — pega 31 de fevereiro. */
function dataValida(valor: string): boolean {
  if (!/^\d{8}$/.test(valor)) return false;
  const dia = Number(valor.slice(0, 2));
  const mes = Number(valor.slice(2, 4));
  const ano = Number(valor.slice(4, 8));
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

type TipoDocumento = 'cnpj' | 'cpf' | 'ambos' | null;

/** O leiaute nao marca qual campo e documento; o nome e o unico indicio. */
function documentoDoCampo(nome: string): TipoDocumento {
  const temCnpj = nome.includes('CNPJ');
  const temCpf = nome.includes('CPF');
  if (temCnpj && temCpf) return 'ambos'; // ex.: CNPJ_CPF_PART
  if (temCnpj) return 'cnpj';
  if (temCpf) return 'cpf';
  return null;
}

/**
 * Aplica as regras da tabela 5.7 a arvore inteira.
 *
 * @param nos    registros a conferir
 * @param layout dicionario de leiaute
 */
export function validar(nos: NoRegistro[], layout: Layout): ResultadoValidacao {
  const erros: ErroValidacao[] = [];
  const avisos: ErroValidacao[] = [];

  for (const no of nos) {
    const onde = { linha: no.linhaOriginal || no.ordem, registro: no.reg };
    const erro = (mensagem: string, campo?: string) =>
      erros.push({ severidade: 'erro', ...onde, campo, mensagem });
    const aviso = (mensagem: string, campo?: string) =>
      avisos.push({ severidade: 'aviso', ...onde, campo, mensagem });

    const registro = layout.registro(no.reg);
    if (!registro) {
      aviso(`Registro "${no.reg}" nao consta no leiaute.`);
      // Sem leiaute nao ha o que conferir campo a campo, mas o pipe ainda
      // quebraria o arquivo.
      for (const valor of no.valores) {
        if (valor.includes('|')) erro('Valor contem "|", que e o delimitador.');
      }
      continue;
    }

    if (no.valores.length !== registro.qtd_campos) {
      aviso(
        `Registro com ${no.valores.length} campos; o leiaute preve ${registro.qtd_campos}.`,
      );
    }

    for (const campo of registro.campos) {
      const valor = no.valores[campo.num - 1];
      if (valor === undefined) continue; // campo ausente: ja avisado acima

      if (valor.includes('|')) {
        erro('Valor contem "|", que e o delimitador.', campo.nome);
      }

      if (valor === '') {
        if (campo.obrigatorio) erro('Campo obrigatorio vazio.', campo.nome);
        continue; // as demais regras nao se aplicam a campo vazio
      }

      // --- tamanho --------------------------------------------------------
      if (campo.tamanho_fixo && campo.tamanho > 0 && valor.length !== campo.tamanho) {
        erro(
          `Campo de tamanho fixo com ${valor.length} caracteres; o leiaute exige ${campo.tamanho}.`,
          campo.nome,
        );
      } else if (!campo.tamanho_fixo && campo.tamanho > 0 && valor.length > campo.tamanho) {
        erro(
          `Campo com ${valor.length} caracteres; o leiaute admite ate ${campo.tamanho}.`,
          campo.nome,
        );
      }

      // --- tipo -----------------------------------------------------------
      const documento = documentoDoCampo(campo.nome);
      if (campo.tipo === 'N' && !/^[0-9,-]*$/.test(valor)) {
        // O CNPJ alfanumerico passou a existir depois do Guia v1.35, que
        // ainda declara o campo como N. Tratar como erro bloquearia um CNPJ
        // legitimo, entao vira aviso — a correcao de verdade e o leiaute
        // passar a declarar C quando a Receita publicar a nova versao.
        if (
          (documento === 'cnpj' || documento === 'ambos') &&
          ehCnpjAlfanumerico(valor)
        ) {
          aviso(
            'CNPJ alfanumerico em campo que o leiaute v1.35 declara como numerico.',
            campo.nome,
          );
        } else {
          erro('Campo numerico com caractere que nao e digito, virgula ou sinal.', campo.nome);
        }
      }

      // --- decimais -------------------------------------------------------
      const virgula = valor.indexOf(',');
      if (virgula >= 0) {
        const casas = valor.length - virgula - 1;
        if (casas > campo.decimais) {
          aviso(
            `Valor com ${casas} casas decimais; o leiaute preve ${campo.decimais}.`,
            campo.nome,
          );
        }
      }

      // --- data -----------------------------------------------------------
      if (ehCampoData(campo.nome, campo.tamanho) && !dataValida(valor)) {
        erro('Data fora do padrao ddmmaaaa ou inexistente.', campo.nome);
      }

      // --- documento ------------------------------------------------------
      if (documento === 'cnpj' && !cnpjValido(valor)) {
        aviso('CNPJ com digito verificador invalido.', campo.nome);
      } else if (documento === 'cpf' && !cpfValido(valor)) {
        aviso('CPF com digito verificador invalido.', campo.nome);
      } else if (documento === 'ambos') {
        // CNPJ_CPF_PART aceita os dois; o comprimento decide qual conferir.
        const ok = valor.length === 14 ? cnpjValido(valor) : cpfValido(valor);
        if (!ok) aviso('CNPJ/CPF com digito verificador invalido.', campo.nome);
      }
    }
  }

  return { erros, avisos };
}
