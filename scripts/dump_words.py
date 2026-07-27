#!/usr/bin/env python3
"""Fase 1b: extrai palavras com coordenadas (x0, x1, top) por pagina."""
import json
import sys

import pdfplumber

pdf, ini, fim, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
doc = pdfplumber.open(pdf)
saida = []
for i in range(ini, min(fim, len(doc.pages))):
    pg = doc.pages[i]
    palavras = [
        {
            "t": w["text"],
            "x0": round(w["x0"], 1),
            "x1": round(w["x1"], 1),
            "y": round(w["top"], 1),
        }
        for w in pg.extract_words(use_text_flow=False, keep_blank_chars=False)
    ]
    saida.append({"page": i, "words": palavras})
with open(out, "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False)
print("ok", ini, fim, len(saida))
