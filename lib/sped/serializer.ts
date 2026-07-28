// AST -> TXT. Ver docs/SPEC.md secao 5.6.
//
// Latin-1, CRLF, pipe nas pontas, sem linha em branco. Errar qualquer um
// desses quatro pontos gera arquivo recusado pelo PVA.
import type { ErroValidacao, NoRegistro } from './types';

/**
 * Equivalentes de um so caractere para simbolos comuns que NAO existem em
 * ISO-8859-1 e que a decomposicao Unicode nao resolve (nao sao letra com
 * acento). Um caractere para um caractere de proposito: campo de tamanho
 * fixo nao pode mudar de comprimento na serializacao.
 */
const EQUIVALENTES: Readonly<Record<string, string>> = {
  '‐': '-', // hifen
  '‑': '-', // hifen sem quebra
  '‒': '-', // traco de digito
  '–': '-', // meia-risca
  '—': '-', // travessao
  '―': '-', // barra horizontal
  '‘': "'", // aspa simples esquerda
  '’': "'", // aspa simples direita
  '‚': ',',
  '“': '"', // aspa dupla esquerda
  '”': '"', // aspa dupla direita
  '•': '*', // marcador
  '…': '.', // reticencias
  '€': 'E', // euro
  '™': 'T', // marca registrada
  ' ': ' ', // espaco sem quebra (existe em Latin-1, mas confunde)
};

/**
 * Converte um caractere fora do Latin-1 no equivalente mais proximo.
 * Devolve null quando nao ha equivalente razoavel.
 */
function equivalenteLatin1(ch: string): string | null {
  // Letra com acento fora do Latin-1 (ex.: 'ā', 'ő'): decompoe e descarta os
  // sinais diacriticos. Preserva o comprimento, porque so remove combinantes.
  const semAcento = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (semAcento.length === 1 && semAcento.charCodeAt(0) <= 255) return semAcento;

  return EQUIVALENTES[ch] ?? null;
}

/** Um valor esta pronto para Latin-1 se todo caractere cabe em um byte. */
function precisaTratamento(valor: string): boolean {
  for (let i = 0; i < valor.length; i++) {
    if (valor.charCodeAt(i) > 255) return true;
  }
  return false;
}

function ajustaParaLatin1(
  valor: string,
  avisos: ErroValidacao[],
  contexto: { linha: number; registro: string },
): string {
  if (!precisaTratamento(valor)) return valor;

  let saida = '';
  for (const ch of valor) {
    if (ch.charCodeAt(0) <= 255) {
      saida += ch;
      continue;
    }
    const equivalente = equivalenteLatin1(ch);
    if (equivalente !== null) {
      saida += equivalente;
      avisos.push({
        severidade: 'aviso',
        linha: contexto.linha,
        registro: contexto.registro,
        mensagem: `Caractere "${ch}" nao existe em ISO-8859-1; substituido por "${equivalente}".`,
      });
    } else {
      saida += '?';
      avisos.push({
        severidade: 'aviso',
        linha: contexto.linha,
        registro: contexto.registro,
        mensagem: `Caractere "${ch}" nao existe em ISO-8859-1 e nao tem equivalente; substituido por "?".`,
      });
    }
  }
  return saida;
}

/**
 * Monta o TXT da EFD-Contribuicoes a partir da arvore de registros.
 *
 * @param nos    registros; sao ordenados por `ordem`, sem alterar o array
 *               recebido
 * @param avisos array opcional onde acumular as substituicoes de caractere.
 *               A spec 5.6 manda avisar, mas o contrato devolve Buffer — sem
 *               este parametro o aviso nao teria para onde ir.
 */
export function serializarTxt(nos: NoRegistro[], avisos: ErroValidacao[] = []): Buffer {
  const ordenados = [...nos].sort((a, b) => a.ordem - b.ordem);

  const linhas = ordenados.map((no, indice) => {
    const numeroLinha = indice + 1;
    const contexto = { linha: numeroLinha, registro: no.reg };

    const valores = no.valores.map((valor) => {
      // Pipe dentro do valor deslocaria todos os campos seguintes na
      // releitura; quebra de linha partiria o registro em dois. Nos dois
      // casos o arquivo sai corrompido de forma silenciosa.
      if (valor.includes('|')) {
        avisos.push({
          severidade: 'aviso',
          linha: numeroLinha,
          registro: no.reg,
          mensagem: 'Valor contem "|", que e o delimitador; o arquivo gerado ficara desalinhado.',
        });
      }
      if (/[\r\n]/.test(valor)) {
        avisos.push({
          severidade: 'aviso',
          linha: numeroLinha,
          registro: no.reg,
          mensagem: 'Valor contem quebra de linha; o registro sera partido no arquivo gerado.',
        });
      }
      return ajustaParaLatin1(valor, avisos, contexto);
    });

    return `|${valores.join('|')}|`;
  });

  // Nenhuma linha em branco: a construcao acima sempre produz ao menos "||",
  // mas a regra e do PVA e a garantia fica explicita.
  for (let i = 0; i < linhas.length; i++) {
    if ((linhas[i] ?? '').trim() === '') {
      avisos.push({
        severidade: 'aviso',
        linha: i + 1,
        mensagem: 'Linha em branco descartada; o PVA recusa arquivo com linha em branco.',
      });
    }
  }
  const semBranco = linhas.filter((l) => l.trim() !== '');

  if (semBranco.length === 0) return Buffer.alloc(0);

  // CRLF entre as linhas e tambem no fim do arquivo.
  return Buffer.from(semBranco.join('\r\n') + '\r\n', 'latin1');
}
