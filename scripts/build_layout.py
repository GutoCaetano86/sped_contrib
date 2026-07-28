#!/usr/bin/env python3
"""
Constroi o dicionario de leiaute da EFD-Contribuicoes a partir do
Guia Pratico (PDF da Receita Federal).

!!! INCOMPLETO — NAO RODAR PARA REGERAR data/layout_efd_contribuicoes.json !!!

    Esta versao troca o parser posicional pela leitura de tabela com borda.
    Conserta os nomes estilhacados (ver mais abaixo), mas PERDE cobertura:
    180 registros / 1.281 campos, contra 192 / 1.624 do dicionario em uso.
    0111 e D100 somem por inteiro e o 0000 fica com buracos, porque nem
    toda tabela do guia tem borda desenhada.

    O caminho e HIBRIDO: usar a celula com borda quando existir e cair no
    parser posicional (com o regex de nome corrigido) quando nao existir,
    fundindo os dois por numero de campo. Enquanto isso nao estiver feito,
    o dicionario valido continua sendo o que esta versionado em data/.

Estrategia: as tabelas de leiaute do guia sao TABELAS COM BORDA. O
pdfplumber devolve as celulas ja delimitadas em `extract_tables()`, o que
resolve de uma vez os dois defeitos da versao anterior deste script, que
montava os campos por coordenada:

  1. Nome de campo com acento, minuscula ou hifen (NIVEL do 0500,
     TP_CT-e do D100) era rejeitado por um regex [A-Z0-9_] e o campo
     inteiro sumia.
  2. Quando a linha do numero e a linha do nome nao coincidiam em Y, o
     fragmento do nome era concatenado no campo anterior. Era assim que
     REG + VL_REC_CAIXA viravam "REGVL_REC_CAIXA" e sobrava "XA" no
     campo seguinte.

Com celula delimitada, o nome vem inteiro no formato "VL_REC_CAI\\nXA":
basta remover a quebra de linha.

Cada tabela e associada ao seu registro pela descricao do campo 01, que no
guia e sempre `Texto fixo contendo "XXXX"`. Tabela que continua na pagina
seguinte nao repete o cabecalho e e anexada ao registro corrente.

Entrada:
    chunks/c*.json  (texto + tables por pagina)  -> dump_pages.py

Saida:
    layout_efd_contribuicoes.json
"""
import glob
import json
import re
from collections import Counter

RE_REG_TITULO = re.compile(r"^Registro\s+([0-9A-Z][0-9A-Z]{3}):\s*(.+)$", re.MULTILINE)
RE_NIVEL = re.compile(r"N[íi]vel\s+hier[áa]rquico\s*[-–]\s*(\d+)")
RE_OCOR = re.compile(r"Ocorr[êe]ncia\s*[-–]\s*([^\n]+)")
RE_NUM = re.compile(r"^\d{1,2}$")
# ancora que identifica de que registro e a tabela
RE_ANCORA_REG = re.compile(r"Texto\s+fixo\s+contendo\s*[“\"']?\s*([0-9A-Z]{4})")
RE_CAB = ("Campo", "Tipo")


def limpa(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()


def limpa_nome(s):
    """Nome de campo nao tem espaco: a quebra de linha e so o PDF embrulhando."""
    return re.sub(r"\s+", "", s or "")


def e_cabecalho(linha):
    textos = [limpa(c) for c in linha]
    return all(any(alvo == t for t in textos) for alvo in RE_CAB)


def normaliza_colunas(tabela):
    """
    Descarta colunas vazias em todas as linhas.

    Conforme a pagina, o pdfplumber devolve a mesma tabela com 7 colunas ou
    com 14 — nesse caso intercalando uma coluna vazia por causa das duas
    bordas de cada celula. Sem isto, metade das tabelas do guia nao casa com
    o formato esperado e o registro inteiro se perde.
    """
    if not tabela:
        return tabela
    largura = max(len(ln) for ln in tabela)
    normal = [list(ln) + [None] * (largura - len(ln)) for ln in tabela]
    usadas = [i for i in range(largura) if any(limpa(ln[i]) for ln in normal)]
    return [[ln[i] for i in usadas] for ln in normal]


def monta_campo(linha):
    """Converte uma linha de 7 celulas em um campo, ou None se nao for campo."""
    cels = [(c or "") for c in linha]
    if len(cels) < 7:
        return None
    num_txt = limpa(cels[0])
    if not RE_NUM.match(num_txt):
        return None

    nome = limpa_nome(cels[1])
    if not nome:
        return None

    tipo = limpa(cels[3]).upper()
    tipo = tipo if tipo in ("C", "N") else ""

    tam_txt = limpa(cels[4])
    fixo = "*" in tam_txt
    tam_dig = re.sub(r"[^\d]", "", tam_txt)
    tamanho = int(tam_dig) if tam_dig else 0

    dec_dig = re.sub(r"[^\d]", "", limpa(cels[5]))
    decimais = int(dec_dig) if dec_dig else 0

    obrig = limpa(cels[6]).upper()

    return {
        "num": int(num_txt),
        "nome": nome,
        "descricao": limpa(cels[2])[:400],
        "tipo": tipo,
        "tamanho": tamanho,
        "tamanho_fixo": fixo,
        "decimais": decimais,
        "obrigatorio": obrig == "S",
    }


def coleta_campos(paginas):
    """Percorre as tabelas de todas as paginas e agrupa os campos por registro."""
    por_registro = {}
    corrente = None

    for p in paginas:
        for tabela in p.get("tables") or []:
            if not tabela:
                continue
            linhas = normaliza_colunas(tabela)
            # pula o cabecalho, quando a tabela o traz
            idx_cab = next((i for i, ln in enumerate(linhas) if e_cabecalho(ln)), None)
            if idx_cab is not None:
                linhas = linhas[idx_cab + 1:]

            for linha in linhas:
                campo = monta_campo(linha)
                if campo is None:
                    continue
                # o campo 01 identifica a que registro a tabela pertence
                if campo["num"] == 1:
                    m = RE_ANCORA_REG.search(campo["descricao"])
                    if m:
                        corrente = m.group(1)
                        por_registro.setdefault(corrente, {"campos": [], "pagina": p["page"] + 1})
                if corrente is None:
                    continue
                por_registro[corrente]["campos"].append(campo)

    # remove numero repetido, mantendo a primeira ocorrencia, e ordena
    for dados in por_registro.values():
        vistos, final = set(), []
        for c in sorted(dados["campos"], key=lambda x: x["num"]):
            if c["num"] in vistos:
                continue
            vistos.add(c["num"])
            final.append(c)
        dados["campos"] = final
    return por_registro


def coleta_metadados(paginas):
    """titulo / nivel / ocorrencia, lidos do texto corrido de cada registro."""
    meta = {}
    corrente = None
    buffer = {}
    for p in paginas:
        texto = p["text"]
        marcas = list(RE_REG_TITULO.finditer(texto))
        if not marcas:
            if corrente:
                buffer[corrente] = buffer.get(corrente, "") + "\n" + texto
            continue
        if corrente and marcas[0].start() > 0:
            buffer[corrente] = buffer.get(corrente, "") + "\n" + texto[: marcas[0].start()]
        for i, m in enumerate(marcas):
            corrente = m.group(1)
            fim = marcas[i + 1].start() if i + 1 < len(marcas) else len(texto)
            meta.setdefault(corrente, {"titulo": limpa(m.group(2)), "pagina": p["page"] + 1})
            buffer[corrente] = buffer.get(corrente, "") + "\n" + texto[m.start(): fim]

    for reg, texto in buffer.items():
        n = RE_NIVEL.search(texto)
        o = RE_OCOR.search(texto)
        meta.setdefault(reg, {"titulo": None, "pagina": 0})
        meta[reg]["nivel"] = int(n.group(1)) if n else None
        meta[reg]["ocorrencia"] = limpa(o.group(1)) if o else None
    return meta


def pendencias(registros):
    """Registros que ainda nao passam nos criterios de integridade."""
    saida = []
    for k, v in registros.items():
        campos = v["campos"]
        nums = [c["num"] for c in campos]
        if not nums:
            continue
        motivos = []
        if nums != list(range(1, len(nums) + 1)):
            faltando = [n for n in range(1, max(nums) + 1) if n not in nums]
            motivos.append(f"numeracao nao sequencial; ausentes: {faltando}")
        if campos[0]["nome"] != "REG":
            motivos.append("campo 01 deveria ser REG")
        sem_tipo = [c["num"] for c in campos if c["tipo"] not in ("C", "N")]
        if sem_tipo:
            motivos.append(f"tipo nao identificado nos campos {sem_tipo}")
        repetidos = [n for n, q in Counter(c["nome"] for c in campos).items() if q > 1]
        if repetidos:
            motivos.append(f"nome de campo repetido: {sorted(repetidos)}")
        if motivos:
            saida.append(
                {
                    "registro": k,
                    "pagina_guia": v["pagina_guia"],
                    "campos_extraidos": len(nums),
                    "motivos": motivos,
                }
            )
    return saida


def main():
    paginas = []
    for a in sorted(glob.glob("chunks/c*.json")):
        paginas.extend(json.load(open(a, encoding="utf-8")))
    paginas.sort(key=lambda p: p["page"])

    campos_por_reg = coleta_campos(paginas)
    meta = coleta_metadados(paginas)

    registros = {}
    for reg, dados in campos_por_reg.items():
        if not dados["campos"]:
            continue
        m = meta.get(reg, {})
        registros[reg] = {
            "registro": reg,
            "bloco": reg[0],
            "titulo": m.get("titulo"),
            "nivel": m.get("nivel"),
            "ocorrencia": m.get("ocorrencia"),
            "pagina_guia": m.get("pagina") or dados["pagina"],
            "qtd_campos": len(dados["campos"]),
            "campos": dados["campos"],
        }

    ordem = "0ACDFIMP19"
    registros = dict(
        sorted(registros.items(), key=lambda kv: (ordem.find(kv[0][0]), kv[0]))
    )

    saida = {
        "layout": "EFD-Contribuicoes",
        "versao_guia": "1.35",
        "data_guia": "2021-06-18",
        "fonte": "Guia Pratico da EFD-Contribuicoes v1.35 - Receita Federal do Brasil",
        "arquivo": {
            "delimitador": "|",
            "encoding": "ISO-8859-1",
            "quebra_linha": "CRLF",
            "linha_inicia_e_termina_com_delimitador": True,
            "separador_decimal": ",",
            "formato_data": "ddmmaaaa",
            "formato_periodo": "mmaaaa",
            "formato_hora": "hhmmss",
            "sem_linhas_em_branco": True,
        },
        "blocos": {
            "0": "Abertura, Identificacao e Referencias",
            "A": "Documentos Fiscais - Servicos (ISS)",
            "C": "Documentos Fiscais I - Mercadorias (ICMS/IPI)",
            "D": "Documentos Fiscais II - Servicos (ICMS)",
            "F": "Demais Documentos e Operacoes",
            "I": "Operacoes das Instituicoes Financeiras e Assemelhadas",
            "M": "Apuracao da Contribuicao e Credito de PIS/PASEP e COFINS",
            "P": "Apuracao da Contribuicao Previdenciaria sobre a Receita Bruta",
            "1": "Complemento da Escrituracao",
            "9": "Controle e Encerramento do Arquivo Digital",
        },
        "ordem_blocos": ["0", "A", "C", "D", "F", "I", "M", "P", "1", "9"],
        "total_registros": len(registros),
        "total_campos": sum(r["qtd_campos"] for r in registros.values()),
        "revisao_manual": pendencias(registros),
        "registros": registros,
    }
    with open("layout_efd_contribuicoes.json", "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)

    print(f"TOTAL: {len(registros)} registros, {saida['total_campos']} campos")
    print("por bloco:", dict(Counter(r[0] for r in registros)))
    esperado = {"0000": 14, "0110": 5, "0200": 12, "C100": 29, "C170": 37,
                "M100": 15, "M200": 13, "M600": 13, "9900": 3, "9999": 2}
    for k, exp in esperado.items():
        r = registros.get(k)
        got = r["qtd_campos"] if r else 0
        print(f"  {k}: {got} campos (esperado ~{exp}) {'OK' if got == exp else '<<'}")
    print("pendentes de revisao:", len(saida["revisao_manual"]))


if __name__ == "__main__":
    main()
