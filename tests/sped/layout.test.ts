import { describe, expect, it } from 'vitest';
import {
  CAMINHO_PADRAO_LAYOUT,
  ErroLayoutInvalido,
  carregarLayout,
  limparCacheLayout,
  obterLayout,
} from '@/lib/sped/layout';

const layout = carregarLayout();

describe('carregarLayout — totais', () => {
  it('carrega os 192 registros e 1.662 campos declarados', () => {
    expect(layout.layout).toBe('EFD-Contribuicoes');
    expect(layout.versao_guia).toBe('1.35');
    expect(layout.total_registros).toBe(192);
    expect(layout.registros.size).toBe(192);

    const somaCampos = [...layout.registros.values()].reduce(
      (soma, r) => soma + r.campos.length,
      0,
    );
    // 1.624 na extracao original; 1.662 depois de F1-T3 fechar os 27 registros
    // que estavam com campo perdido, nome estilhacado ou tipo indefinido.
    expect(layout.total_campos).toBe(1662);
    expect(somaCampos).toBe(1662);
  });

  it('expoe as caracteristicas do arquivo e a ordem dos blocos', () => {
    expect(layout.arquivo.encoding).toBe('ISO-8859-1');
    expect(layout.arquivo.delimitador).toBe('|');
    expect(layout.arquivo.quebra_linha).toBe('CRLF');
    expect(layout.arquivo.separador_decimal).toBe(',');
    expect(layout.ordem_blocos).toEqual(['0', 'A', 'C', 'D', 'F', 'I', 'M', 'P', '1', '9']);
  });
});

describe('carregarLayout — registro existente', () => {
  it('devolve o 0000 com metadados do guia', () => {
    const reg = layout.registro('0000');
    expect(reg).toBeDefined();
    expect(reg?.registro).toBe('0000');
    expect(reg?.bloco).toBe('0');
    expect(reg?.nivel).toBe(0);
    expect(reg?.ocorrencia).toBe('um (por arquivo)');
    expect(reg?.qtd_campos).toBe(14);
    expect(reg?.campos).toHaveLength(14);
  });

  it('devolve registros de outros blocos', () => {
    expect(layout.registro('C100')?.bloco).toBe('C');
    expect(layout.registro('M200')?.bloco).toBe('M');
    expect(layout.registro('9999')?.bloco).toBe('9');
  });
});

describe('carregarLayout — registro inexistente', () => {
  it('devolve undefined em vez de lancar', () => {
    expect(layout.registro('XXXX')).toBeUndefined();
    expect(layout.registro('')).toBeUndefined();
    // 9998 nao existe; 9999 existe. Protege contra busca por prefixo.
    expect(layout.registro('9998')).toBeUndefined();
    expect(layout.registro('9999')).toBeDefined();
  });

  it('campo() de registro inexistente devolve undefined', () => {
    expect(layout.campo('XXXX', 'REG')).toBeUndefined();
  });
});

describe('carregarLayout — campo por nome', () => {
  it('acha o campo e preserva os atributos do leiaute', () => {
    const cnpj = layout.campo('0000', 'CNPJ');
    expect(cnpj).toEqual({
      num: 9,
      nome: 'CNPJ',
      descricao: expect.any(String),
      tipo: 'N',
      tamanho: 14,
      tamanho_fixo: true,
      decimais: 0,
      obrigatorio: true,
    });
  });

  it('distingue obrigatorio de opcional e fixo de variavel', () => {
    // NOME: C 100, sem asterisco no guia -> tamanho maximo, nao exato.
    expect(layout.campo('0000', 'NOME')).toMatchObject({
      num: 8,
      tipo: 'C',
      tamanho: 100,
      tamanho_fixo: false,
      obrigatorio: true,
    });
    // SUFRAMA: opcional.
    expect(layout.campo('0000', 'SUFRAMA')).toMatchObject({ num: 12, obrigatorio: false });
  });

  it('acha os campos 6 a 9 que o parser usa para montar o cabecalho', () => {
    // Ver spec 5.2, passo 5.
    expect(layout.campo('0000', 'DT_INI')?.num).toBe(6);
    expect(layout.campo('0000', 'DT_FIN')?.num).toBe(7);
    expect(layout.campo('0000', 'NOME')?.num).toBe(8);
    expect(layout.campo('0000', 'CNPJ')?.num).toBe(9);
  });

  it('campo inexistente devolve undefined', () => {
    expect(layout.campo('0000', 'NAO_EXISTE')).toBeUndefined();
    expect(layout.registro('0000')?.campoPorNome.get('cnpj')).toBeUndefined(); // sensivel a caixa
  });

  it('todo registro tem indice por nome consistente com o array de campos', () => {
    for (const reg of layout.registros.values()) {
      const nomesDistintos = new Set(reg.campos.map((c) => c.nome));
      expect(reg.campoPorNome.size).toBe(nomesDistintos.size);
      for (const [nome, campo] of reg.campoPorNome) {
        expect(campo.nome).toBe(nome);
      }
    }
  });
});

describe('carregarLayout — indice por numero de campo', () => {
  it('indexa pelo numero declarado, nao pela posicao no array', () => {
    // Invariante: vale com ou sem buraco na numeracao, entao nao quebra
    // conforme F1-T3 vai fechando os registros.
    for (const reg of layout.registros.values()) {
      for (const campo of reg.campos) {
        expect(reg.campoPorNum.get(campo.num)).toBe(campo);
      }
      expect(reg.campoPorNum.size).toBe(reg.campos.length);
    }
  });

  it('nos registros que ainda tem buraco, campos[num - 1] erraria', () => {
    // Enquanto F1-T3 nao fecha, sobram registros com numeracao furada. Este
    // teste se auto-desliga quando o ultimo for corrigido — e ai o teste de
    // integridade do dicionario passa a cobrir o caso.
    const comBuraco = [...layout.registros.values()].filter((r) =>
      r.campos.some((c, i) => c.num !== i + 1),
    );
    if (comBuraco.length === 0) return;

    for (const reg of comBuraco) {
      const primeiroBuraco = reg.campos.find((c, i) => c.num !== i + 1);
      expect(primeiroBuraco).toBeDefined();
      const num = primeiroBuraco!.num;
      // o indice acha pelo numero...
      expect(reg.campoPorNum.get(num)?.nome).toBe(primeiroBuraco!.nome);
      // ...e a indexacao ingenua devolveria outro campo, ou nada
      expect(reg.campos[num - 1]).not.toBe(primeiroBuraco);
    }
  });
});

describe('carregarLayout — deteccao de defeito de integridade', () => {
  // O dicionario de verdade esta limpo desde F1-T3 — o que a integridade
  // dele valha esta em dicionario.test.ts. Aqui o alvo e o MECANISMO: sem
  // uma fixture defeituosa, nada mais exercitaria avisosIntegridade e a
  // deteccao poderia apodrecer sem ninguem notar.
  const defeituoso = () => carregarLayout('tests/fixtures/layout_defeituoso.json');

  it('acha nome de campo repetido e diz quais numeros colidem', () => {
    const aviso = defeituoso().avisosIntegridade.find((a) => a.motivo === 'nome_duplicado');
    expect(aviso).toMatchObject({ registro: '0000', campo: 'VL_REC' });
    expect(aviso?.mensagem).toMatch(/2 e 3/);
  });

  it('em nome repetido o indice guarda a PRIMEIRA ocorrencia', () => {
    const reg = defeituoso().registro('0000');
    expect(reg?.campoPorNome.get('VL_REC')?.num).toBe(2);
    expect(reg?.campos.filter((c) => c.nome === 'VL_REC')).toHaveLength(2);
    // a segunda so e alcancavel por numero
    expect(reg?.campoPorNum.get(3)?.nome).toBe('VL_REC');
  });

  it('acha numeracao com buraco', () => {
    const aviso = defeituoso().avisosIntegridade.find((a) => a.motivo === 'num_nao_sequencial');
    expect(aviso?.registro).toBe('C100');
  });

  it('acha tipo nao identificado', () => {
    const aviso = defeituoso().avisosIntegridade.find(
      (a) => a.motivo === 'tipo_nao_identificado',
    );
    expect(aviso).toMatchObject({ registro: 'F100', campo: 'SEM_TIPO' });
  });

  it('acha campo 01 diferente de REG', () => {
    const aviso = defeituoso().avisosIntegridade.find((a) => a.motivo === 'campo_01_nao_e_reg');
    expect(aviso).toMatchObject({ registro: 'M100', campo: 'REGCOD_CRED' });
  });

  it('carrega o dicionario defeituoso mesmo assim, sem lancar', () => {
    // Defeito de integridade e aviso, nao erro: o produto precisa rodar com
    // dicionario imperfeito. So falha de schema ou total incoerente lanca.
    const layoutRuim = defeituoso();
    expect(layoutRuim.registros.size).toBe(4);
    expect(layoutRuim.avisosIntegridade.length).toBeGreaterThanOrEqual(4);
  });
});

describe('obterLayout — cache', () => {
  it('reaproveita a instancia e recarrega apos limpar', () => {
    limparCacheLayout();
    const primeiro = obterLayout();
    expect(obterLayout()).toBe(primeiro);

    limparCacheLayout();
    const depois = obterLayout();
    expect(depois).not.toBe(primeiro);
    expect(depois.registros.size).toBe(primeiro.registros.size);
  });
});

describe('carregarLayout — falhas', () => {
  it('lanca ErroLayoutInvalido quando o arquivo nao existe', () => {
    expect(() => carregarLayout('data/nao_existe.json')).toThrow(ErroLayoutInvalido);
  });

  it('lanca ErroLayoutInvalido quando o JSON nao bate com o schema', () => {
    // package-lock.json e JSON valido, mas nao e um dicionario de leiaute.
    expect(() => carregarLayout('package-lock.json')).toThrow(/fora do schema/);
  });

  it('o caminho padrao aponta para o dicionario versionado', () => {
    expect(CAMINHO_PADRAO_LAYOUT.replace(/\\/g, '/')).toBe('data/layout_efd_contribuicoes.json');
  });
});
