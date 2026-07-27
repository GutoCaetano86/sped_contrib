#!/usr/bin/env python3
"""
Constroi o dicionario de leiaute da EFD-Contribuicoes a partir do
Guia Pratico (PDF da Receita Federal).

Estrategia: parser POSICIONAL. As tabelas de leiaute do guia tem o
cabecalho "Nº | Campo | Descricao | Tipo | Tam | Dec | Obrig". Usamos as
coordenadas X desse cabecalho para definir as faixas de cada coluna e
atribuimos cada palavra da pagina a uma coluna. Isso resolve os casos em
que o nome do campo ou o tipo/tamanho ficam quebrados em varias linhas.

Entradas:
    chunks/c*.json  (texto das paginas)   -> dump_pages.py
    words/w*.json   (palavras + coords)   -> dump_words.py

Saida:
    layout_efd_contribuicoes.json
"""
import glob
import json
import re
from collections import Counter, defaultdict

RE_REG_TITULO = re.compile(r"^Registro\s+([0-9A-Z][0-9A-Z]{3}):\s*(.+)$", re.MULTILINE)
RE_NIVEL = re.compile(r"N[íi]vel\s+hier[áa]rquico\s*[-–]\s*(\d+)")
RE_OCOR = re.compile(r"Ocorr[êe]ncia\s*[-–]\s*([^\n]+)")
RE_NUM = re.compile(r"^\d{2}$")
RE_TIPO = re.compile(r"^[CN]$")
RE_TAM = re.compile(r"^(\d{1,4}\*?|[-–])$")
RE_DEC = re.compile(r"^(\d{1,2}|[-–])$")
RE_OBRIG = re.compile(r"^[SNO]$")
# fragmento de nome de campo: precisa conter ao menos uma letra, para nao
# absorver o numero da linha seguinte (ex.: "01") dentro do nome.
RE_NOME_FRAG = re.compile(r"^(?=[A-Z0-9_]*[A-Z])[A-Z][A-Z0-9_]*$")

COLS = ["num", "nome", "desc", "tipo", "tam", "dec", "obrig"]


def limpa(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()


def agrupa_linhas(palavras, tol=3.0):
    """Agrupa palavras por coordenada Y aproximada."""
    linhas = defaultdict(list)
    chaves = []
    for w in sorted(palavras, key=lambda w: (w["y"], w["x0"])):
        alvo = next((k for k in chaves if abs(k - w["y"]) <= tol), None)
        if alvo is None:
            alvo = w["y"]
            chaves.append(alvo)
        linhas[alvo].append(w)
    return [(y, sorted(linhas[y], key=lambda w: w["x0"])) for y in sorted(linhas)]


def acha_cabecalhos(linhas):
    """Retorna [(y, limites_de_coluna)] para cada cabecalho de tabela na pagina."""
    saida = []
    for y, ws in linhas:
        textos = [w["t"] for w in ws]
        if len(textos) >= 6 and textos[0] in ("Nº", "N°", "No") and "Campo" in textos[:3]:
            pos = {}
            for w in ws:
                t = w["t"]
                if t in ("Nº", "N°", "No"):
                    pos["num"] = w
                elif t == "Campo":
                    pos["nome"] = w
                elif t.startswith("Descri"):
                    pos["desc"] = w
                elif t == "Tipo":
                    pos["tipo"] = w
                elif t == "Tam":
                    pos["tam"] = w
                elif t == "Dec":
                    pos["dec"] = w
                elif t.startswith("Obrig"):
                    pos["obrig"] = w
            if len(pos) == 7:
                # fronteira = ponto medio entre o fim de uma coluna e o inicio da proxima
                lim = []
                for a, b in zip(COLS, COLS[1:]):
                    lim.append((pos[a]["x1"] + pos[b]["x0"]) / 2)
                saida.append((y, lim))
    return saida


def coluna_de(w, lim):
    x = (w["x0"] + w["x1"]) / 2
    for i, fronteira in enumerate(lim):
        if x < fronteira:
            return COLS[i]
    return COLS[-1]


def celulas_da_pagina(palavras, y_min=0, y_max=1e9):
    """Devolve lista de linhas: {'num':[...], 'nome':[...], ...} em ordem de leitura."""
    linhas = agrupa_linhas(palavras)
    cabs = acha_cabecalhos(linhas)
    if not cabs:
        return []
    saida = []
    for idx, (y_cab, lim) in enumerate(cabs):
        y_fim = cabs[idx + 1][0] if idx + 1 < len(cabs) else 1e9
        for y, ws in linhas:
            if y <= y_cab or y >= y_fim or not (y_min <= y <= y_max):
                continue
            cel = defaultdict(list)
            for w in ws:
                cel[coluna_de(w, lim)].append(w["t"])
            saida.append({c: cel.get(c, []) for c in COLS})
    return saida


def fim_da_tabela(linha):
    """Detecta o rodape do registro (Observacoes / Nivel hierarquico / Campo NN -)."""
    txt = " ".join(linha["num"] + linha["nome"] + linha["desc"])
    return bool(
        re.match(r"^(Observa|N[íi]vel\s+hier|Ocorr[êe]ncia|Campo\s+\d{2}\s*[-–])", txt)
    )


def monta_campos(linhas_cel):
    campos, atual = [], None
    for ln in linhas_cel:
        if fim_da_tabela(ln):
            # rodape do registro (Observacoes / Nivel / notas "Campo NN - ...").
            # encerra o campo corrente sem descartar o que ja foi lido.
            if atual:
                campos.append(atual)
                atual = None
            continue
        nums = [t for t in ln["num"] if RE_NUM.match(t)]
        if nums:
            if atual:
                campos.append(atual)
            atual = {
                "num": int(nums[0]),
                "nome": "",
                "descricao": "",
                "tipo": "",
                "tamanho": None,
                "tamanho_fixo": False,
                "decimais": None,
                "obrigatorio": None,
            }
        if atual is None:
            continue
        # nome pode vir fragmentado em varias linhas
        for t in ln["nome"]:
            if RE_NOME_FRAG.match(t):
                atual["nome"] += t
        if ln["desc"]:
            atual["descricao"] += " " + " ".join(ln["desc"])
        for t in ln["tipo"]:
            if RE_TIPO.match(t) and not atual["tipo"]:
                atual["tipo"] = t
        for t in ln["tam"]:
            if RE_TAM.match(t) and atual["tamanho"] is None:
                atual["tamanho_fixo"] = "*" in t
                v = t.replace("*", "").replace("–", "").replace("-", "")
                atual["tamanho"] = int(v) if v.isdigit() else 0
        for t in ln["dec"]:
            if RE_DEC.match(t) and atual["decimais"] is None:
                v = t.replace("–", "").replace("-", "")
                atual["decimais"] = int(v) if v.isdigit() else 0
        for t in ln["obrig"]:
            if RE_OBRIG.match(t) and atual["obrigatorio"] is None:
                atual["obrigatorio"] = t == "S"
    if atual:
        campos.append(atual)

    vistos, final = set(), []
    for c in sorted(campos, key=lambda x: x["num"]):
        if c["num"] in vistos or not c["nome"]:
            continue
        vistos.add(c["num"])
        c["descricao"] = limpa(c["descricao"])[:400]
        c["tamanho"] = c["tamanho"] or 0
        c["decimais"] = c["decimais"] or 0
        c["obrigatorio"] = bool(c["obrigatorio"])
        final.append(c)
    return final


# ---------------------------------------------------------------------------
# Parser alternativo (baseado no texto linear). Serve de rede de seguranca:
# alguns registros do guia tem cabecalho de tabela fora do padrao, e nesses
# casos o parser posicional nao encontra a tabela.
# ---------------------------------------------------------------------------
RE_CAMPO_TXT = re.compile(
    r"^(?P<num>\d{2})\s+"
    r"(?P<nome>[A-Z][A-Z0-9_]*)[;:.]?\s+"
    r"(?P<desc>.*?)\s+"
    r"(?P<tipo>[CN])\s+"
    r"(?P<tam>\d{1,4}\s?\*?|[-–])\s+"
    r"(?P<dec>[-–]|\d{1,2})\s+"
    r"(?P<obrig>[SNO])\s*$"
)
RE_QUEBRA_NOME = re.compile(r"^([A-Z][A-Z0-9_]{0,11})(?:\s+(.*))?$")


def monta_campos_texto(texto):
    campos, atual, apos_def = [], None, False
    for linha in texto.split("\n"):
        s = linha.strip()
        if not s or s.startswith("Guia Prático da EFD") or s.startswith("Nº Campo"):
            continue
        m = RE_CAMPO_TXT.match(s)
        if m:
            if atual:
                campos.append(atual)
            tam = m.group("tam").replace(" ", "")
            fixo = "*" in tam
            tam = re.sub(r"[*\-–]", "", tam)
            dec = re.sub(r"[\-–]", "", m.group("dec")).strip()
            atual = {
                "num": int(m.group("num")),
                "nome": m.group("nome"),
                "descricao": limpa(m.group("desc")),
                "tipo": m.group("tipo"),
                "tamanho": int(tam) if tam.isdigit() else 0,
                "tamanho_fixo": fixo,
                "decimais": int(dec) if dec.isdigit() else 0,
                "obrigatorio": m.group("obrig") == "S",
            }
            apos_def = True
            continue
        if atual is None:
            continue
        if apos_def and len(atual["nome"]) >= 9:
            q = RE_QUEBRA_NOME.match(s)
            if q:
                atual["nome"] += q.group(1)
                if q.group(2):
                    atual["descricao"] += " " + limpa(q.group(2))
                apos_def = False
                continue
        atual["descricao"] += " " + limpa(s)
        apos_def = False
    if atual:
        campos.append(atual)
    vistos, final = set(), []
    for c in sorted(campos, key=lambda x: x["num"]):
        if c["num"] in vistos:
            continue
        vistos.add(c["num"])
        c["descricao"] = limpa(c["descricao"])[:400]
        final.append(c)
    return final


def funde(pos, txt):
    """Une os dois parsers: base = o que tiver mais campos; buracos vem do outro."""
    base, extra = (pos, txt) if len(pos) >= len(txt) else (txt, pos)
    por_num = {c["num"]: c for c in base}
    for c in extra:
        if c["num"] not in por_num:
            por_num[c["num"]] = c
        else:
            # completa lacunas pontuais (nome truncado, tipo vazio)
            a = por_num[c["num"]]
            if len(c["nome"]) > len(a["nome"]):
                a["nome"] = c["nome"]
            if not a["tipo"] and c["tipo"]:
                a["tipo"] = c["tipo"]
            if not a["descricao"]:
                a["descricao"] = c["descricao"]
    campos = [por_num[n] for n in sorted(por_num)]
    # descarta numeros muito acima da sequencia (linhas de exemplo do guia
    # que o OCR posicional confunde com campos)
    final, esperado = [], 1
    for c in campos:
        if c["num"] - esperado > 2:
            break
        final.append(c)
        esperado = c["num"] + 1
    return final


def revisao_manual(registros):
    """Lista registros cuja numeracao de campos ficou com lacunas.

    Sao poucos casos em que o PDF quebra a tabela de forma atipica. O
    desenvolvedor deve conferir esses registros na pagina indicada do guia
    antes de liberar o parser para producao.
    """
    pendentes = []
    for k, v in registros.items():
        campos = v["campos"]
        nums = [c["num"] for c in campos]
        if not nums:
            continue
        motivos = []
        faltando = [n for n in range(1, max(nums) + 1) if n not in nums]
        if faltando:
            motivos.append(f"campos ausentes: {faltando}")
        if not campos or campos[0]["nome"] != "REG":
            motivos.append("campo 01 deveria ser REG")
        sem_tipo = [c["num"] for c in campos if c["tipo"] not in ("C", "N")]
        if sem_tipo:
            motivos.append(f"tipo nao identificado nos campos {sem_tipo}")
        if motivos:
            pendentes.append(
                {
                    "registro": k,
                    "pagina_guia": v["pagina_guia"],
                    "campos_extraidos": len(nums),
                    "motivos": motivos,
                }
            )
    return pendentes


def main():
    textos = {}
    for a in sorted(glob.glob("chunks/c*.json")):
        for p in json.load(open(a, encoding="utf-8")):
            textos[p["page"]] = p["text"]
    palavras = {}
    for a in sorted(glob.glob("words/w*.json")):
        for p in json.load(open(a, encoding="utf-8")):
            palavras[p["page"]] = p["words"]

    paginas = sorted(set(textos) & set(palavras))

    registros = {}
    reg = titulo = pag_ini = None
    buf_txt, buf_cel = [], []

    def fecha():
        nonlocal reg, titulo, pag_ini, buf_txt, buf_cel
        if reg:
            texto = "\n".join(buf_txt)
            campos = funde(monta_campos(buf_cel), monta_campos_texto(texto))
            if campos:
                n = RE_NIVEL.search(texto)
                o = RE_OCOR.search(texto)
                registros[reg] = {
                    "registro": reg,
                    "bloco": reg[0],
                    "titulo": titulo,
                    "nivel": int(n.group(1)) if n else None,
                    "ocorrencia": limpa(o.group(1)) if o else None,
                    "pagina_guia": pag_ini + 1,
                    "qtd_campos": len(campos),
                    "campos": campos,
                }
        reg = titulo = pag_ini = None
        buf_txt, buf_cel = [], []

    for p in paginas:
        texto = textos[p]
        ws = palavras[p]
        marcas = list(RE_REG_TITULO.finditer(texto))
        if not marcas:
            if reg:
                buf_txt.append(texto)
                buf_cel.extend(celulas_da_pagina(ws))
            continue
        # localiza a coordenada Y de cada titulo para fatiar a pagina
        ys = []
        for m in marcas:
            alvo = m.group(1)
            cand = [
                w["y"]
                for w in ws
                if w["t"] == "Registro" or w["t"].startswith(alvo)
            ]
            ys.append(min(cand) if cand else 0)
        if reg and marcas[0].start() > 0:
            buf_txt.append(texto[: marcas[0].start()])
            buf_cel.extend(celulas_da_pagina(ws, 0, ys[0]))
        for i, m in enumerate(marcas):
            fecha()
            reg, titulo, pag_ini = m.group(1), limpa(m.group(2)), p
            fim_txt = marcas[i + 1].start() if i + 1 < len(marcas) else len(texto)
            y_fim = ys[i + 1] if i + 1 < len(ys) else 1e9
            buf_txt.append(texto[m.start(): fim_txt])
            buf_cel.extend(celulas_da_pagina(ws, ys[i], y_fim))
    fecha()

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
        "revisao_manual": revisao_manual(registros),
        "registros": registros,
    }
    with open("layout_efd_contribuicoes.json", "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)

    print(f"TOTAL: {len(registros)} registros")
    print("por bloco:", dict(Counter(r[0] for r in registros)))
    esperado = {"0000": 14, "0110": 5, "0200": 12, "C100": 29, "C170": 37,
                "M100": 15, "M200": 13, "M600": 13, "9900": 3, "9999": 2}
    for k, exp in esperado.items():
        r = registros.get(k)
        got = r["qtd_campos"] if r else 0
        print(f"  {k}: {got} campos (esperado ~{exp}) {'OK' if got == exp else '<<'}")
    buracos = []
    for k, v in registros.items():
        nums = [c["num"] for c in v["campos"]]
        if nums != list(range(1, len(nums) + 1)):
            buracos.append(k)
    print("registros com numeracao nao sequencial:", len(buracos), buracos[:20])


if __name__ == "__main__":
    main()
