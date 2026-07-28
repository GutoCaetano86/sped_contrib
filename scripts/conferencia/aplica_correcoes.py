#!/usr/bin/env python3
"""
Aplica ao dicionario as correcoes conferidas no Guia Pratico v1.35.

Em Python, e nao em Node, de proposito: o JSON.parse do V8 promove chave
que parece inteiro ("1001", "9900") para o inicio do objeto, o que reordena
metade do dicionario e produz um diff de 9.000 linhas para uma mudanca de
8 registros. O dict do Python preserva a ordem de insercao, e o json.dump
com indent=1 reproduz a formatacao que o build_layout.py gerou.

Cada correcao abaixo cita a pagina do guia onde foi lida.

Uso: python scripts/conferencia/aplica_correcoes.py
"""
import json
from collections import OrderedDict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CAMINHO = RAIZ / "data" / "layout_efd_contribuicoes.json"


def campo(num, nome, descricao, tipo, tamanho, tamanho_fixo, decimais, obrigatorio):
    return OrderedDict(
        num=num,
        nome=nome,
        descricao=descricao,
        tipo=tipo,
        tamanho=tamanho,
        tamanho_fixo=tamanho_fixo,
        decimais=decimais,
        obrigatorio=obrigatorio,
    )


def main():
    dic = json.loads(CAMINHO.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
    regs = dic["registros"]

    def substitui(reg, campos, pagina):
        r = regs[reg]
        r["campos"] = campos
        r["qtd_campos"] = len(campos)
        r["pagina_guia"] = pagina

    def insere(reg, novo):
        r = regs[reg]
        if any(c["num"] == novo["num"] for c in r["campos"]):
            raise SystemExit(f"{reg} ja tem campo {novo['num']}")
        r["campos"].append(novo)
        r["campos"].sort(key=lambda c: c["num"])
        r["qtd_campos"] = len(r["campos"])

    def corrige(reg, num, **mudancas):
        alvo = next((c for c in regs[reg]["campos"] if c["num"] == num), None)
        if alvo is None:
            raise SystemExit(f"{reg} nao tem campo {num}")
        alvo.update(mudancas)

    def remove(reg, num):
        r = regs[reg]
        r["campos"] = [c for c in r["campos"] if c["num"] != num]
        r["qtd_campos"] = len(r["campos"])

    # --- 0111, paginas 74-75 ------------------------------------------------
    # O sufixo _MI do campo 02 ficou na linha seguinte da celula e se perdeu.
    corrige(
        "0111", 2,
        nome="REC_BRU_NCUM_TRIB_MI",
        descricao="Receita Bruta Não-Cumulativa - Tributada no Mercado Interno",
    )
    insere("0111", campo(
        3, "REC_BRU_NCUM_NT_MI",
        "Receita Bruta Não-Cumulativa – Não Tributada no Mercado Interno (Vendas com "
        "suspensão, alíquota zero, isenção e sem incidência das contribuições)",
        "N", 0, False, 2, True))
    insere("0111", campo(
        4, "REC_BRU_NCUM_EXP",
        "Receita Bruta Não-Cumulativa – Exportação", "N", 0, False, 2, True))

    # --- 0500, pagina 89 ----------------------------------------------------
    # "NÍVEL" tem acento; o regex de nome do extrator antigo so aceitava
    # [A-Z0-9_], entao o campo sumiu inteiro. Gravado sem acento, como os
    # demais nomes do dicionario.
    insere("0500", campo(
        5, "NIVEL", "Nível da conta analítica/grupo de contas.", "N", 5, False, 0, True))

    # --- 1100, paginas 384-385 ----------------------------------------------
    # A tabela saiu com 8 dos 18 campos, com nome fundido (CNPJ_SUCCNPJ) e
    # truncado (VL_CRED_DESC). Substituida por inteiro.
    substitui("1100", [
        campo(1, "REG", 'Texto fixo contendo "1100"', "C", 4, True, 0, True),
        campo(2, "PER_APU_CRED", "Período de Apuração do Crédito (MM/AAAA)", "N", 6, False, 0, True),
        campo(3, "ORIG_CRED", "Indicador da origem do crédito: 01 – Crédito decorrente de "
              "operações próprias; 02 – Crédito transferido por pessoa jurídica sucedida.",
              "N", 2, True, 0, True),
        campo(4, "CNPJ_SUC", "CNPJ da pessoa jurídica cedente do crédito (se ORIG_CRED = 02).",
              "N", 14, True, 0, False),
        campo(5, "COD_CRED", "Código do Tipo do Crédito, conforme Tabela 4.3.6.", "N", 3, True, 0, True),
        campo(6, "VL_CRED_APU", "Valor total do crédito apurado na Escrituração Fiscal Digital "
              "(Registro M100) ou em demonstrativo DACON (Fichas 06A e 06B) de período anterior.",
              "N", 0, False, 2, True),
        campo(7, "VL_CRED_EXT_APU", "Valor de Crédito Extemporâneo Apurado (Registro 1101), "
              "referente a Período Anterior, Informado no Campo 02 – PER_APU_CRED",
              "N", 0, False, 2, False),
        campo(8, "VL_TOT_CRED_APU", "Valor Total do Crédito Apurado (06 + 07)", "N", 0, False, 2, True),
        campo(9, "VL_CRED_DESC_PA_ANT", "Valor do Crédito utilizado mediante Desconto, em "
              "Período(s) Anterior(es).", "N", 0, False, 2, True),
        campo(10, "VL_CRED_PER_PA_ANT", "Valor do Crédito utilizado mediante Pedido de "
              "Ressarcimento, em Período(s) Anterior(es).", "N", 0, False, 2, False),
        campo(11, "VL_CRED_DCOMP_PA_ANT", "Valor do Crédito utilizado mediante Declaração de "
              "Compensação Intermediária (Crédito de Exportação), em Período(s) Anterior(es).",
              "N", 0, False, 2, False),
        campo(12, "SD_CRED_DISP_EFD", "Saldo do Crédito Disponível para Utilização neste "
              "Período de Escrituração (08 – 09 – 10 - 11).", "N", 0, False, 2, True),
        campo(13, "VL_CRED_DESC_EFD", "Valor do Crédito descontado neste período de escrituração.",
              "N", 0, False, 2, False),
        campo(14, "VL_CRED_PER_EFD", "Valor do Crédito objeto de Pedido de Ressarcimento (PER) "
              "neste período de escrituração.", "N", 0, False, 2, False),
        campo(15, "VL_CRED_DCOMP_EFD", "Valor do Crédito utilizado mediante Declaração de "
              "Compensação Intermediária neste período de escrituração.", "N", 0, False, 2, False),
        campo(16, "VL_CRED_TRANS", "Valor do crédito transferido em evento de cisão, fusão ou "
              "incorporação.", "N", 0, False, 2, False),
        campo(17, "VL_CRED_OUT", "Valor do crédito utilizado por outras formas.", "N", 0, False, 2, False),
        campo(18, "SLD_CRED_FIM", "Saldo de créditos a utilizar em período de apuração futuro "
              "(12 – 13 – 14 – 15 – 16 - 17).", "N", 0, False, 2, False),
    ], 384)

    # --- 9990, pagina 415 ---------------------------------------------------
    # O campo 03 nao existe: QTD_REG_BLC vazou do 9900, que esta na mesma
    # pagina do guia, logo acima.
    remove("9990", 3)
    corrige(
        "9990", 2,
        nome="QTD_LIN_9", descricao="Quantidade total de linhas do Bloco 9.",
        tipo="N", tamanho=0, tamanho_fixo=False, decimais=0, obrigatorio=True,
    )

    # --- C500, pagina 166 ---------------------------------------------------
    # CHV_DOCe tem "e" minusculo: rejeitado pelo regex do extrator antigo.
    insere("C500", campo(
        15, "CHV_DOCe", "Chave do Documento Fiscal Eletrônico", "N", 44, True, 0, False))

    # --- D100, pagina 195 ---------------------------------------------------
    # TP_CT-e tem hifen e minuscula: mesmo motivo.
    insere("D100", campo(
        13, "TP_CT-e",
        "Tipo de Conhecimento de Transporte Eletrônico conforme definido no Manual de "
        "Integração do CT-e", "N", 1, True, 0, False))

    # --- M110, paginas 303-304 ----------------------------------------------
    insere("M110", campo(
        4, "COD_AJ", "Código do ajuste, conforme a Tabela indicada no item 4.3.8.",
        "C", 2, True, 0, True))

    # --- M500, paginas 329-330 ----------------------------------------------
    insere("M500", campo(
        3, "IND_CRED_ORI",
        "Indicador de Crédito Oriundo de: 0 – Operações próprias; 1 – Evento de "
        "incorporação, cisão ou fusão", "N", 1, True, 0, True))

    # --- totais -------------------------------------------------------------
    dic["total_registros"] = len(regs)
    dic["total_campos"] = sum(len(r["campos"]) for r in regs.values())

    CAMINHO.write_text(
        json.dumps(dic, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n"
    )

    for cod in ["0111", "0500", "1100", "9990", "C500", "D100", "M110", "M500"]:
        r = regs[cod]
        nums = [c["num"] for c in r["campos"]]
        seq = nums == list(range(1, len(nums) + 1))
        print(f"  {cod:<6} {len(nums):>2} campos | sequencial: {'sim' if seq else 'NAO'}")
    print(f"\ntotal_registros: {dic['total_registros']} | total_campos: {dic['total_campos']}")


if __name__ == "__main__":
    main()
