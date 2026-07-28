// TXT -> AST. Ver docs/SPEC.md secao 5.2.
//
// Regra inviolavel deste modulo: NUNCA lanca excecao por conteudo invalido
// do usuario. Todo problema vira item em `erros` ou `avisos` e a leitura
// prossegue. Quem chama sempre recebe um ResultadoParse.
import type { ErroValidacao, Layout, NoRegistro, ResultadoParse } from './types';

/** Cabecalho vazio, usado quando o arquivo nao tem um 0000 legivel. */
const CABECALHO_VAZIO = { cnpj: '', razaoSocial: '', dtIni: '', dtFin: '' };

/**
 * Nivel hierarquico do registro.
 *
 * O dicionario e a fonte; ele falha em dois casos, e nenhum pode derrubar a
 * leitura: registro fora do dicionario (o bloco I tem leiaute em ADE
 * separado, entao I001/I990 aparecem em arquivo real e nao constam aqui) e
 * registro com `nivel` nulo por falha de extracao (0035 e C860).
 *
 * A convencao estrutural do SPED cobre os dois: abertura e encerramento de
 * bloco sao nivel 1, o 0000 e o 9999 sao nivel 0. Fora disso, herda o nivel
 * do registro anterior — trata como irmao, que e o palpite menos destrutivo
 * para a pilha.
 */
function nivelDe(reg: string, layout: Layout, nivelAnterior: number): number {
  const doDicionario = layout.registro(reg)?.nivel;
  if (typeof doDicionario === 'number') return doDicionario;
  if (reg === '0000' || reg === '9999') return 0;
  if (/^.001$/.test(reg) || /^.990$/.test(reg)) return 1;
  return nivelAnterior;
}

/** Id curto e deterministico. Deterministico de proposito: o round-trip da
 *  secao 9.2 precisa ser reproduzivel entre execucoes. */
function idDe(sequencia: number): string {
  return `r${String(sequencia).padStart(6, '0')}`;
}

/**
 * Le o TXT da EFD-Contribuicoes e devolve a arvore de registros.
 *
 * @param conteudo bytes do arquivo, como vieram do disco ou do upload
 * @param layout   dicionario de leiaute carregado
 */
export function parseTxt(conteudo: Buffer, layout: Layout): ResultadoParse {
  const erros: ErroValidacao[] = [];
  const avisos: ErroValidacao[] = [];
  const nos: NoRegistro[] = [];

  const erro = (mensagem: string, extra: Partial<ErroValidacao> = {}) =>
    erros.push({ severidade: 'erro', mensagem, ...extra });
  const aviso = (mensagem: string, extra: Partial<ErroValidacao> = {}) =>
    avisos.push({ severidade: 'aviso', mensagem, ...extra });

  let texto: string;
  try {
    texto = conteudo.toString('latin1');
  } catch {
    // Buffer.toString('latin1') nao lanca na pratica; a guarda existe para
    // sustentar a promessa de nunca lancar.
    erro('Nao foi possivel decodificar o arquivo como ISO-8859-1.');
    return { nos, cabecalho: { ...CABECALHO_VAZIO }, erros, avisos };
  }

  // BOM de UTF-8 lido como Latin-1 vira "ï»¿" e contaminaria o primeiro
  // registro. Arquivo da EFD nao deveria ter, mas editor de texto poe.
  if (texto.startsWith('﻿') || texto.startsWith('ï»¿')) {
    texto = texto.replace(/^(﻿|ï»¿)/, '');
    aviso('Arquivo comeca com BOM; removido na leitura. O PVA nao aceita BOM.', { linha: 1 });
  }

  const linhas = texto.split(/\r\n|\n/);
  // A ultima quebra de linha do arquivo produz um elemento vazio no fim, que
  // e o fim do arquivo e nao uma linha em branco.
  if (linhas.length > 0 && linhas[linhas.length - 1] === '') linhas.pop();

  const pilha: NoRegistro[] = [];
  let nivelAnterior = 0;

  for (let i = 0; i < linhas.length; i++) {
    const numeroLinha = i + 1;
    const linha = linhas[i] ?? '';

    if (linha.trim() === '') {
      // Regra do PVA: linha em branco no meio invalida a importacao.
      erro('Linha em branco. O PVA recusa arquivo com linha em branco.', { linha: numeroLinha });
      continue;
    }

    if (!linha.startsWith('|') || !linha.endsWith('|') || linha.length < 2) {
      erro('Linha nao comeca e termina com "|".', { linha: numeroLinha });
      continue;
    }

    // Os pipes das pontas sao delimitadores, nao conteudo.
    const valores = linha.slice(1, -1).split('|');
    const reg = valores[0] ?? '';
    const registroLayout = layout.registro(reg);

    if (!registroLayout) {
      // Nunca descartar dado do usuario: a linha vira no opaco e sera
      // devolvida intacta na serializacao.
      aviso(`Registro "${reg}" nao consta no leiaute; linha preservada como opaca.`, {
        linha: numeroLinha,
        registro: reg,
      });
    } else if (valores.length !== registroLayout.qtd_campos) {
      // Aviso, e so. NAO preenchemos nem truncamos: alterar `valores` aqui
      // quebraria o round-trip byte a byte da secao 9.2, e ha registro real
      // em que o dicionario e que esta errado (D100 tem 23 campos no
      // arquivo aprovado pelo PVA e 22 no dicionario). Ver
      // docs/DICIONARIO-ACHADOS.md.
      aviso(
        `Registro ${reg} com ${valores.length} campos; leiaute preve ${registroLayout.qtd_campos}.`,
        { linha: numeroLinha, registro: reg },
      );
    }

    const nivel = nivelDe(reg, layout, nivelAnterior);

    const no: NoRegistro = {
      id: idDe(nos.length + 1),
      paiId: null,
      reg,
      nivel,
      ordem: nos.length + 1,
      valores,
      linhaOriginal: numeroLinha,
    };

    if (nivel > 0) {
      const pai = pilha[nivel - 1];
      if (pai) {
        no.paiId = pai.id;
      } else {
        aviso(`Registro ${reg} de nivel ${nivel} sem pai de nivel ${nivel - 1} acima.`, {
          linha: numeroLinha,
          registro: reg,
        });
      }
    }

    // Nivel pulado nao pode corromper a pilha: descarta o que estava em
    // niveis mais fundos e assume esta posicao.
    pilha.length = Math.min(pilha.length, nivel);
    pilha[nivel] = no;
    nivelAnterior = nivel;

    nos.push(no);
  }

  return { nos, cabecalho: extraiCabecalho(nos, avisos), erros, avisos };
}

/**
 * Cabecalho da escrituracao, lido do registro 0000.
 * Campos 6 a 9 do leiaute: DT_INI, DT_FIN, NOME, CNPJ (spec 5.2, passo 5).
 * `valores` e 0-based e `valores[0]` e o REG, entao o campo N esta em N - 1.
 */
function extraiCabecalho(nos: NoRegistro[], avisos: ErroValidacao[]): ResultadoParse['cabecalho'] {
  const no = nos.find((n) => n.reg === '0000');
  if (!no) {
    avisos.push({
      severidade: 'aviso',
      mensagem: 'Arquivo sem registro 0000; cabecalho nao pode ser extraido.',
    });
    return { ...CABECALHO_VAZIO };
  }
  return {
    dtIni: no.valores[5] ?? '',
    dtFin: no.valores[6] ?? '',
    razaoSocial: no.valores[7] ?? '',
    cnpj: no.valores[8] ?? '',
  };
}
