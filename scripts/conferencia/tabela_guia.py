#!/usr/bin/env python3
"""
Mostra a tabela de leiaute de paginas do Guia Pratico, para conferencia
manual de um registro.

Dois modos, porque nenhum funciona sozinho em todas as paginas:

  --borda      (padrao) usa extract_tables(). Celula delimitada pela borda
               da tabela: o nome vem inteiro, mesmo quebrado em duas linhas
               ("VL_REC_CAI\\nXA"). Falha nas paginas cuja tabela nao tem
               borda desenhada.
  --posicional agrupa as palavras por coordenada Y e mostra o x0 de cada
               uma. Funciona sempre, mas exige leitura humana para juntar
               nome quebrado e associar numero a linha.

Uso:
    python tabela_guia.py 74-75
    python tabela_guia.py --posicional 262 310
    python tabela_guia.py --acha M210        # descobre a pagina pela ancora

A pagina e 1-based e bate com o campo `pagina_guia` do dicionario.
"""
import argparse
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import pdfplumber

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parents[2]
PDF = RAIZ / "docs" / "Guia-Pratico-EFD-Contribuicoes-v1.35.pdf"

# nas notas depois da tabela nao ha mais campo a extrair
FIM = re.compile(
    r"^(Observações|Observação|Nível|Ocorrência|Validação|Campo\s+\d{2}\s*[-–]|Registro\s+[0-9A-Z]{4}\s*:)"
)
RODAPE = re.compile(r"^Guia\s+Prático\s+da\s+EFD")


def agrupa(palavras, tol=3.0):
    linhas = defaultdict(list)
    chaves = []
    for w in sorted(palavras, key=lambda w: (w["top"], w["x0"])):
        alvo = next((k for k in chaves if abs(k - w["top"]) <= tol), None)
        if alvo is None:
            alvo = w["top"]
            chaves.append(alvo)
        linhas[alvo].append(w)
    return [(y, sorted(linhas[y], key=lambda w: w["x0"])) for y in sorted(linhas)]


def mostra_borda(pg):
    for i, tab in enumerate(pg.extract_tables()):
        if not tab:
            continue
        print(f"--- tabela {i}: {len(tab)} linhas x {len(tab[0])} colunas")
        for row in tab:
            cels = [(c or "").replace("\n", "\\n") for c in row]
            # descarta as colunas vazias que aparecem quando o pdfplumber
            # enxerga as duas bordas de cada celula
            cels = [c for c in cels if c.strip()] or cels
            print("   ", " | ".join(cels))


def mostra_posicional(pg):
    linhas = agrupa(pg.extract_words())
    tem_cab = any(
        "Campo" in [w["text"] for w in ws]
        and ("Tipo" in [w["text"] for w in ws] or "Tam" in [w["text"] for w in ws])
        for _y, ws in linhas
    )
    dentro = not tem_cab  # tabela continuada nao repete o cabecalho
    for _y, ws in linhas:
        textos = [w["text"] for w in ws]
        junto = " ".join(textos)
        if "Campo" in textos and ("Tipo" in textos or "Tam" in textos):
            dentro = True
            print("CABECALHO:", " ".join(f'{w["text"]}@{w["x0"]:.0f}' for w in ws))
            continue
        if not dentro or RODAPE.match(junto):
            continue
        if FIM.match(junto):
            print("  [fim da tabela]")
            dentro = False
            continue
        print("  " + "  ".join(f'{w["text"]}@{w["x0"]:.0f}' for w in ws))


def acha_pagina(doc, registro):
    """Localiza a tabela do registro pela ancora `Texto fixo contendo "XXXX"`.

    Procurar por "Registro XXXX:" nao serve: o guia cita registros em prosa
    o tempo todo e a primeira ocorrencia costuma ser uma referencia cruzada.
    """
    alvo = re.compile(r"Texto\s+fixo\s+contendo\s*[“\"']?\s*" + registro)
    for i, pg in enumerate(doc.pages):
        texto = re.sub(r"\s+", " ", pg.extract_text() or "")
        if alvo.search(texto):
            return i + 1
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("alvos", nargs="*", help="paginas (74, 74-75) ou nada com --acha")
    ap.add_argument("--posicional", action="store_true")
    ap.add_argument("--acha", metavar="REGISTRO")
    args = ap.parse_args()

    with pdfplumber.open(PDF) as doc:
        if args.acha:
            pag = acha_pagina(doc, args.acha.upper())
            print(f"{args.acha.upper()}: pagina {pag}" if pag else f"{args.acha}: nao achado")
            if not pag:
                return
            paginas = [pag, pag + 1]
        else:
            paginas = []
            for a in args.alvos:
                if "-" in a:
                    ini, fim = a.split("-")
                    paginas.extend(range(int(ini), int(fim) + 1))
                else:
                    paginas.append(int(a))

        for p in paginas:
            print(f"\n{'=' * 78}\nPAGINA {p}\n{'=' * 78}")
            pg = doc.pages[p - 1]
            if args.posicional:
                mostra_posicional(pg)
            else:
                mostra_borda(pg)


if __name__ == "__main__":
    main()
