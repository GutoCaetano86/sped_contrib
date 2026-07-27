#!/usr/bin/env python3
"""Fase 1: extrai texto + linhas de tabela cruas de um intervalo de paginas."""
import json
import sys

import pdfplumber

pdf, ini, fim, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
doc = pdfplumber.open(pdf)
saida = []
for i in range(ini, min(fim, len(doc.pages))):
    pg = doc.pages[i]
    saida.append(
        {
            "page": i,
            "text": pg.extract_text() or "",
            "tables": pg.extract_tables(),
        }
    )
with open(out, "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False)
print("ok", ini, fim, len(saida))
