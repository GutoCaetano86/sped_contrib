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
  it('carrega os 192 registros e 1.624 campos declarados', () => {
    expect(layout.layout).toBe('EFD-Contribuicoes');
    expect(layout.versao_guia).toBe('1.35');
    expect(layout.total_registros).toBe(192);
    expect(layout.registros.size).toBe(192);

    const somaCampos = [...layout.registros.values()].reduce(
      (soma, r) => soma + r.campos.length,
      0,
    );
    // 1.624 na extracao original; 1.640 depois de F1-T3 corrigir os 8
    // registros que os arquivos reais aprovados pelo PVA provaram errados.
    expect(layout.total_campos).toBe(1640);
    expect(somaCampos).toBe(1640);
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

describe('carregarLayout — pendencias e integridade do dicionario', () => {
  it('expoe os 21 registros de revisao_manual', () => {
    expect(layout.pendencias).toHaveLength(21);
    expect(layout.pendencias.map((p) => p.registro)).toContain('0111');
    expect(layout.pendencias[0]).toMatchObject({
      registro: expect.any(String),
      pagina_guia: expect.any(Number),
      motivos: expect.any(Array),
    });
  });

  it('reporta os 9 campos sem tipo C/N identificado', () => {
    const semTipo = layout.avisosIntegridade.filter((a) => a.motivo === 'tipo_nao_identificado');
    expect(semTipo).toHaveLength(9);
    // Todos caem em registros ja listados para revisao manual.
    const pendentes = new Set(layout.pendencias.map((p) => p.registro));
    for (const aviso of semTipo) {
      expect(pendentes.has(aviso.registro)).toBe(true);
    }
  });

  it('reporta nomes de campo duplicados, que o indice por nome nao alcanca', () => {
    const duplicados = layout.avisosIntegridade.filter((a) => a.motivo === 'nome_duplicado');
    const porRegistro = new Set(duplicados.map((a) => a.registro));
    expect(porRegistro).toEqual(new Set(['0145', 'C170', 'M210', 'M610']));

    // C170 #28 e #34 sao QUANT_BC de PIS e de COFINS; o sufixo se perdeu na
    // extracao. So a descricao distingue — ver F1-T3.
    const c170 = layout.registro('C170');
    expect(c170?.campoPorNome.get('QUANT_BC')?.num).toBe(28);
    expect(c170?.campos.filter((c) => c.nome === 'QUANT_BC')).toHaveLength(2);
  });

  it('nenhum registro fora de revisao_manual tem numeracao quebrada ou campo 01 diferente de REG', () => {
    const pendentes = new Set(layout.pendencias.map((p) => p.registro));
    const estruturais = layout.avisosIntegridade.filter(
      (a) => a.motivo === 'num_nao_sequencial' || a.motivo === 'campo_01_nao_e_reg',
    );
    const inesperados = estruturais.filter((a) => !pendentes.has(a.registro));
    expect(inesperados).toEqual([]);
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
