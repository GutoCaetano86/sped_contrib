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
        # idempotente: rodar de novo sobre dicionario ja corrigido nao quebra
        existente = next((c for c in r["campos"] if c["num"] == novo["num"]), None)
        if existente is not None:
            if existente["nome"] != novo["nome"]:
                raise SystemExit(
                    f"{reg} campo {novo['num']} ja existe como {existente['nome']}, "
                    f"esperado {novo['nome']}"
                )
            existente.update(novo)
            return
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

    # =======================================================================
    # PARTE 2 — os 15 restantes da revisao_manual.
    #
    # Diferenca importante em relacao aos 8 acima: NENHUM destes aparece nos
    # arquivos reais disponiveis, entao nao tem a contraprova do PVA. A fonte
    # e o guia, conferida contra a transcricao do autor em
    # "Registros faltantes.txt". Onde as duas se sobrepoem com o que ja fora
    # lido do PDF (C396, C880, D201, F500, F510), bate campo a campo.
    #
    # Estes vao como substituicao inteira, e nao insercao: a extracao
    # estilhacou os nomes (F510 tinha campos chamados "XA" e "ANT"), entao
    # nao ha o que aproveitar.
    # =======================================================================

    # C396, pagina 152
    substitui("C396", [
        campo(1, "REG", 'Texto fixo contendo "C396"', "C", 4, True, 0, True),
        campo(2, "COD_ITEM", "Código do item (campo 02 do Registro 0200)", "C", 60, False, 0, True),
        campo(3, "VL_ITEM", "Valor total do item (mercadorias ou serviços)", "N", 0, False, 2, True),
        campo(4, "VL_DESC", "Valor do desconto comercial do item", "N", 0, False, 2, False),
        campo(5, "NAT_BC_CRED", "Código da Base de Cálculo do Crédito, conforme a Tabela indicada no item 4.3.7.", "C", 2, True, 0, True),
        campo(6, "CST_PIS", "Código da Situação Tributária referente ao PIS/PASEP", "N", 2, True, 0, True),
        campo(7, "VL_BC_PIS", "Valor da base de cálculo do crédito de PIS/PASEP", "N", 0, False, 2, False),
        campo(8, "ALIQ_PIS", "Alíquota do PIS/PASEP (em percentual)", "N", 8, False, 4, False),
        campo(9, "VL_PIS", "Valor do crédito de PIS/PASEP", "N", 0, False, 2, False),
        campo(10, "CST_COFINS", "Código da Situação Tributária referente a COFINS", "N", 2, True, 0, True),
        campo(11, "VL_BC_COFINS", "Valor da base de cálculo do crédito de COFINS", "N", 0, False, 2, False),
        campo(12, "ALIQ_COFINS", "Alíquota da COFINS (em percentual)", "N", 8, False, 4, False),
        campo(13, "VL_COFINS", "Valor do crédito de COFINS", "N", 0, False, 2, False),
        campo(14, "COD_CTA", "Código da conta analítica contábil debitada/creditada", "C", 255, False, 0, False),
    ], 152)

    # C810, pagina 180. Descontinuado: o guia marca "nao disponivel para
    # escrituracao no PVA", entao nunca aparece em TXT. Completado assim mesmo
    # para nao precisar de excecao no teste de integridade.
    substitui("C810", [
        campo(1, "REG", 'Texto fixo contendo "C810"', "C", 4, True, 0, True),
        campo(2, "CFOP", "Código fiscal de operação e prestação", "N", 4, False, 0, True),
        campo(3, "VL_ITEM", "Valor total dos itens", "N", 0, False, 2, True),
        campo(4, "COD_ITEM", "Código do item (campo 02 do Registro 0200)", "C", 60, False, 0, False),
        campo(5, "CST_PIS", "Código da Situação Tributária referente ao PIS/PASEP", "N", 2, True, 0, True),
        campo(6, "VL_BC_PIS", "Valor da base de cálculo do PIS/PASEP", "N", 0, False, 2, False),
        campo(7, "ALIQ_PIS", "Alíquota do PIS/PASEP (em percentual)", "N", 8, False, 4, False),
        campo(8, "VL_PIS", "Valor do PIS/PASEP", "N", 0, False, 2, False),
        campo(9, "CST_COFINS", "Código da Situação Tributária referente a COFINS", "N", 2, True, 0, True),
        campo(10, "VL_BC_COFINS", "Valor da base de cálculo da COFINS", "N", 0, False, 2, False),
        campo(11, "ALIQ_COFINS", "Alíquota da COFINS (em percentual)", "N", 8, False, 4, False),
        campo(12, "VL_COFINS", "Valor da COFINS", "N", 0, False, 2, False),
        campo(13, "COD_CTA", "Código da conta analítica contábil debitada/creditada", "C", 255, False, 0, False),
    ], 180)

    # C820, pagina 182. Tambem descontinuado.
    substitui("C820", [
        campo(1, "REG", 'Texto fixo contendo "C820"', "C", 4, True, 0, True),
        campo(2, "CFOP", "Código fiscal de operação e prestação", "N", 4, True, 0, True),
        campo(3, "VL_ITEM", "Valor total dos itens", "N", 0, False, 2, True),
        campo(4, "COD_ITEM", "Código do item (campo 02 do Registro 0200)", "C", 60, False, 0, False),
        campo(5, "CST_PIS", "Código da Situação Tributária referente ao PIS/PASEP", "N", 2, True, 0, True),
        campo(6, "QUANT_BC_PIS", "Base de cálculo em quantidade - PIS/PASEP", "N", 0, False, 3, False),
        campo(7, "ALIQ_PIS_QUANT", "Alíquota do PIS/PASEP (em reais)", "N", 0, False, 4, False),
        campo(8, "VL_PIS", "Valor do PIS/PASEP", "N", 0, False, 2, False),
        campo(9, "CST_COFINS", "Código da Situação Tributária referente a COFINS", "N", 2, True, 0, True),
        campo(10, "QUANT_BC_COFINS", "Base de cálculo em quantidade – COFINS", "N", 0, False, 3, False),
        campo(11, "ALIQ_COFINS_QUANT", "Alíquota da COFINS (em reais)", "N", 0, False, 4, False),
        campo(12, "VL_COFINS", "Valor da COFINS", "N", 0, False, 2, False),
        campo(13, "COD_CTA", "Código da conta analítica contábil debitada/creditada", "C", 255, False, 0, False),
    ], 182)

    # C880, pagina 188
    substitui("C880", [
        campo(1, "REG", 'Texto fixo contendo "C880"', "C", 4, True, 0, True),
        campo(2, "COD_ITEM", "Código do item (campo 02 do Registro 0200)", "C", 60, False, 0, False),
        campo(3, "CFOP", "Código fiscal de operação e prestação", "N", 4, True, 0, True),
        campo(4, "VL_ITEM", "Valor total dos itens", "N", 0, False, 2, True),
        campo(5, "VL_DESC", "Valor da exclusão/desconto comercial dos itens", "N", 0, False, 2, False),
        campo(6, "CST_PIS", "Código da Situação Tributária referente ao PIS/PASEP", "N", 2, True, 0, True),
        campo(7, "QUANT_BC_PIS", "Base de cálculo em quantidade - PIS/PASEP", "N", 0, False, 3, False),
        campo(8, "ALIQ_PIS_QUANT", "Alíquota do PIS/PASEP (em reais)", "N", 0, False, 4, False),
        campo(9, "VL_PIS", "Valor do PIS/PASEP", "N", 0, False, 2, False),
        campo(10, "CST_COFINS", "Código da Situação Tributária referente a COFINS", "N", 2, True, 0, True),
        campo(11, "QUANT_BC_COFINS", "Base de cálculo em quantidade – COFINS", "N", 0, False, 3, False),
        campo(12, "ALIQ_COFINS_QUANT", "Alíquota da COFINS (em reais)", "N", 0, False, 4, False),
        campo(13, "VL_COFINS", "Valor da COFINS", "N", 0, False, 2, False),
        campo(14, "COD_CTA", "Código da conta analítica contábil debitada/creditada", "C", 255, False, 0, False),
    ], 188)

    # D201, paginas 204-205
    substitui("D201", [
        campo(1, "REG", 'Texto fixo contendo "D201"', "C", 4, True, 0, True),
        campo(2, "CST_PIS", "Código da Situação Tributária referente ao PIS/PASEP", "N", 2, True, 0, True),
        campo(3, "VL_ITEM", "Valor total dos itens", "N", 0, False, 2, True),
        campo(4, "VL_BC_PIS", "Valor da base de cálculo do PIS/PASEP", "N", 0, False, 2, False),
        campo(5, "ALIQ_PIS", "Alíquota do PIS/PASEP (em percentual)", "N", 8, False, 4, False),
        campo(6, "VL_PIS", "Valor do PIS/PASEP", "N", 0, False, 2, False),
        campo(7, "COD_CTA", "Código da conta analítica contábil debitada/creditada", "C", 255, False, 0, False),
    ], 204)

    # F500 e F550 tem a mesma estrutura (regime de caixa x competencia), assim
    # como F510 e F560. Muda o nome do campo 02 e a base ser valor ou
    # quantidade.
    def bloco_f_valor(reg, nome_campo2, desc_campo2, pagina):
        substitui(reg, [
            campo(1, "REG", f'Texto fixo contendo "{reg}"', "C", 4, True, 0, True),
            campo(2, nome_campo2, desc_campo2, "N", 0, False, 2, True),
            campo(3, "CST_PIS", "Código da Situação Tributária referente ao PIS/PASEP", "N", 2, True, 0, True),
            campo(4, "VL_DESC_PIS", "Valor do desconto / exclusão da base de cálculo", "N", 0, False, 2, False),
            campo(5, "VL_BC_PIS", "Valor da base de cálculo do PIS/PASEP", "N", 0, False, 2, False),
            campo(6, "ALIQ_PIS", "Alíquota do PIS/PASEP (em percentual)", "N", 8, False, 4, False),
            campo(7, "VL_PIS", "Valor do PIS/PASEP", "N", 0, False, 2, False),
            campo(8, "CST_COFINS", "Código da Situação Tributária referente a COFINS", "N", 2, True, 0, True),
            campo(9, "VL_DESC_COFINS", "Valor do desconto / exclusão da base de cálculo", "N", 0, False, 2, False),
            campo(10, "VL_BC_COFINS", "Valor da base de cálculo da COFINS", "N", 0, False, 2, False),
            campo(11, "ALIQ_COFINS", "Alíquota da COFINS (em percentual)", "N", 8, False, 4, False),
            campo(12, "VL_COFINS", "Valor da COFINS", "N", 0, False, 2, False),
            campo(13, "COD_MOD", "Código do modelo do documento fiscal conforme a Tabela 4.1.1", "C", 2, True, 0, False),
            campo(14, "CFOP", "Código fiscal de operação e prestação", "N", 4, True, 0, False),
            campo(15, "COD_CTA", "Código da conta analítica contábil debitada/creditada", "C", 255, False, 0, False),
            campo(16, "INFO_COMPL", "Informação complementar", "C", 0, False, 0, False),
        ], pagina)

    def bloco_f_quantidade(reg, nome_campo2, desc_campo2, pagina):
        substitui(reg, [
            campo(1, "REG", f'Texto fixo contendo "{reg}"', "C", 4, True, 0, True),
            campo(2, nome_campo2, desc_campo2, "N", 0, False, 2, True),
            campo(3, "CST_PIS", "Código da Situação Tributária referente ao PIS/PASEP", "N", 2, True, 0, True),
            campo(4, "VL_DESC_PIS", "Valor do desconto / exclusão", "N", 0, False, 2, False),
            campo(5, "QUANT_BC_PIS", "Base de cálculo em quantidade - PIS/PASEP", "N", 0, False, 3, False),
            campo(6, "ALIQ_PIS_QUANT", "Alíquota do PIS/PASEP (em reais)", "N", 8, False, 4, False),
            campo(7, "VL_PIS", "Valor do PIS/PASEP", "N", 0, False, 2, False),
            campo(8, "CST_COFINS", "Código da Situação Tributária referente a COFINS", "N", 2, True, 0, True),
            campo(9, "VL_DESC_COFINS", "Valor do desconto / exclusão", "N", 0, False, 2, False),
            campo(10, "QUANT_BC_COFINS", "Base de cálculo em quantidade - COFINS", "N", 0, False, 3, False),
            campo(11, "ALIQ_COFINS_QUANT", "Alíquota da COFINS (em reais)", "N", 8, False, 4, False),
            campo(12, "VL_COFINS", "Valor da COFINS", "N", 0, False, 2, False),
            campo(13, "COD_MOD", "Código do modelo do documento fiscal conforme a Tabela 4.1.1", "C", 2, True, 0, False),
            campo(14, "CFOP", "Código fiscal de operação e prestação", "N", 4, True, 0, False),
            campo(15, "COD_CTA", "Código da conta analítica contábil debitada / creditada", "C", 255, False, 0, False),
            campo(16, "INFO_COMPL", "Informação complementar", "C", 0, False, 0, False),
        ], pagina)

    RECEITA_CAIXA = "Valor total da receita recebida, referente à combinação de CST e Alíquota."
    RECEITA_COMP = "Valor total da receita auferida, referente à combinação de CST e Alíquota."
    bloco_f_valor("F500", "VL_REC_CAIXA", RECEITA_CAIXA, 258)
    bloco_f_quantidade("F510", "VL_REC_CAIXA", RECEITA_CAIXA, 262)
    bloco_f_valor("F550", "VL_REC_COMP", RECEITA_COMP, 268)
    bloco_f_quantidade("F560", "VL_REC_COMP", RECEITA_COMP, 273)

    # M220, pagina 321. Gemeo do M110. O REG aqui e "004" SEM asterisco no
    # guia, ao contrario do M110 que e "004*" — inconsistencia do proprio
    # guia, transcrita como esta.
    substitui("M220", [
        campo(1, "REG", 'Texto fixo contendo "M220"', "C", 4, False, 0, True),
        campo(2, "IND_AJ", "Indicador do tipo de ajuste: 0- Ajuste de redução; 1- Ajuste de acréscimo.", "C", 1, True, 0, True),
        campo(3, "VL_AJ", "Valor do ajuste", "N", 0, False, 2, True),
        campo(4, "COD_AJ", "Código do ajuste, conforme a Tabela indicada no item 4.3.8.", "C", 2, True, 0, True),
        campo(5, "NUM_DOC", "Número do processo, documento ou ato concessório ao qual o ajuste está vinculado, se houver.", "C", 0, False, 0, False),
        campo(6, "DESCR_AJ", "Descrição resumida do ajuste.", "C", 0, False, 0, False),
        campo(7, "DT_REF", "Data de referência do ajuste (ddmmaaaa)", "N", 8, True, 0, False),
    ], 321)

    # P100, pagina 367
    substitui("P100", [
        campo(1, "REG", 'Texto fixo contendo "P100"', "C", 4, True, 0, True),
        campo(2, "DT_INI", "Data inicial a que a apuração se refere", "C", 8, True, 0, True),
        campo(3, "DT_FIN", "Data final a que a apuração se refere", "C", 8, True, 0, True),
        campo(4, "VL_REC_TOT_EST", "Valor da Receita Bruta Total do Estabelecimento no Período", "N", 0, False, 2, True),
        campo(5, "COD_ATIV_ECON", "Código indicador correspondente à atividade sujeita a incidência da Contribuição Previdenciária sobre a Receita Bruta, conforme Tabela 5.1.1.", "C", 8, True, 0, True),
        campo(6, "VL_REC_ATIV_ESTAB", "Valor da Receita Bruta do Estabelecimento, correspondente às atividades/produtos referidos no Campo 05 (COD_ATIV_ECON)", "N", 0, False, 2, True),
        campo(7, "VL_EXC", "Valor das Exclusões da Receita Bruta informada no Campo 06", "N", 0, False, 2, False),
        campo(8, "VL_BC_CONT", "Valor da Base de Cálculo da Contribuição Previdenciária sobre a Receita Bruta (Campo 08 = Campo 06 – Campo 07)", "N", 0, False, 2, True),
        campo(9, "ALIQ_CONT", "Alíquota da Contribuição Previdenciária sobre a Receita Bruta", "N", 8, False, 4, True),
        campo(10, "VL_CONT_APU", "Valor da Contribuição Previdenciária Apurada sobre a Receita Bruta", "N", 0, False, 2, True),
        campo(11, "COD_CTA", "Código da conta analítica contábil referente à Contribuição Previdenciária sobre a Receita Bruta", "C", 255, False, 0, False),
        campo(12, "INFO_COMPL", "Informação complementar do registro", "C", 0, False, 0, False),
    ], 367)

    # 1300 e 1700 sao gemeos (retencao de PIS e de COFINS). A descricao do
    # campo 02 no guia tem mais de 1.500 caracteres listando os codigos;
    # resumida aqui, como os demais campos do dicionario.
    # Atencao: o PR_REC_RET do 1300 e "006" e o do 1700 e "006*". Conferido
    # nas paginas 395 e 407: o guia difere mesmo entre os dois.
    IND_NAT_RET = ("Indicador de Natureza da Retenção na Fonte. Até 2013: 01 a 05 e 99. "
                   "A partir de 2014, rendimentos sujeitos à regra geral: 01 a 05 e 99; "
                   "rendimentos sujeitos à regra específica de incidência cumulativa "
                   "(art. 8º da Lei nº 10.637/2002 e art. 10 da Lei nº 10.833/2003): 51 a 55 e 59.")

    def bloco_retencao(reg, tamanho_pr_rec, pagina):
        substitui(reg, [
            campo(1, "REG", f'Texto fixo contendo "{reg}"', "C", 4, True, 0, True),
            campo(2, "IND_NAT_RET", IND_NAT_RET, "N", 2, True, 0, True),
            campo(3, "PR_REC_RET", "Período do Recebimento e da Retenção (MM/AAAA)", "N", 6, tamanho_pr_rec, 0, True),
            campo(4, "VL_RET_APU", "Valor Total da Retenção", "N", 0, False, 2, True),
            campo(5, "VL_RET_DED", "Valor da Retenção deduzida da Contribuição devida no período da escrituração e em períodos anteriores.", "N", 0, False, 2, True),
            campo(6, "VL_RET_PER", "Valor da Retenção utilizada mediante Pedido de Restituição.", "N", 0, False, 2, True),
            campo(7, "VL_RET_DCOMP", "Valor da Retenção utilizada mediante Declaração de Compensação.", "N", 0, False, 2, True),
            campo(8, "SLD_RET", "Saldo de Retenção a utilizar em períodos de apuração futuros (04 – 05 - 06 - 07).", "N", 0, False, 2, True),
        ], pagina)

    bloco_retencao("1300", False, 394)
    bloco_retencao("1700", True, 406)

    # 1500, pagina 397. Gemeo do 1100, para COFINS.
    substitui("1500", [
        campo(1, "REG", 'Texto fixo contendo "1500"', "C", 4, True, 0, True),
        campo(2, "PER_APU_CRED", "Período de Apuração do Crédito (MM/AAAA)", "N", 6, False, 0, True),
        campo(3, "ORIG_CRED", "Indicador da origem do crédito: 01 – Crédito decorrente de operações próprias; 02 – Crédito transferido por pessoa jurídica sucedida.", "N", 2, True, 0, True),
        campo(4, "CNPJ_SUC", "CNPJ da pessoa jurídica cedente do crédito (se ORIG_CRED = 02).", "N", 14, True, 0, False),
        campo(5, "COD_CRED", "Código do Tipo do Crédito, conforme Tabela 4.3.6.", "N", 3, True, 0, True),
        campo(6, "VL_CRED_APU", "Valor Total do crédito apurado na Escrituração Fiscal Digital (Registro M500) ou em demonstrativo DACON (Fichas 16A e 16B) de período anterior.", "N", 0, False, 2, True),
        campo(7, "VL_CRED_EXT_APU", "Valor de Crédito Extemporâneo Apurado (Registro 1501), referente a Período Anterior, Informado no Campo 02 – PER_APU_CRED", "N", 0, False, 2, False),
        campo(8, "VL_TOT_CRED_APU", "Valor Total do Crédito Apurado (06 + 07)", "N", 0, False, 2, True),
        campo(9, "VL_CRED_DESC_PA_ANT", "Valor do Crédito utilizado mediante Desconto, em Período(s) Anterior(es)", "N", 0, False, 2, True),
        campo(10, "VL_CRED_PER_PA_ANT", "Valor do Crédito utilizado mediante Pedido de Ressarcimento, em Período(s) Anterior(es).", "N", 0, False, 2, False),
        campo(11, "VL_CRED_DCOMP_PA_ANT", "Valor do Crédito utilizado mediante Declaração de Compensação Intermediária (Crédito de Exportação), em Período(s) Anterior(es)", "N", 0, False, 2, False),
        campo(12, "SD_CRED_DISP_EFD", "Saldo do Crédito Disponível para Utilização neste Período de Escrituração (08-09-10-11)", "N", 0, False, 2, True),
        campo(13, "VL_CRED_DESC_EFD", "Valor do Crédito descontado neste período de escrituração", "N", 0, False, 2, False),
        campo(14, "VL_CRED_PER_EFD", "Valor do Crédito objeto de Pedido de Ressarcimento (PER) neste período de escrituração", "N", 0, False, 2, False),
        campo(15, "VL_CRED_DCOMP_EFD", "Valor do Crédito utilizado mediante Declaração de Compensação Intermediária neste período de escrituração", "N", 0, False, 2, False),
        campo(16, "VL_CRED_TRANS", "Valor do crédito transferido em evento de cisão, fusão ou incorporação", "N", 0, False, 2, False),
        campo(17, "VL_CRED_OUT", "Valor do crédito utilizado por outras formas", "N", 0, False, 2, False),
        campo(18, "SLD_CRED_FIM", "Saldo de créditos a utilizar em período de apuração futuro (12-13-14-15-16-17).", "N", 0, False, 2, True),
    ], 397)

    # 1620, pagina 405
    substitui("1620", [
        campo(1, "REG", 'Texto fixo contendo "1620"', "C", 4, True, 0, True),
        campo(2, "PER_APU_CRED", "Período de Apuração do Crédito (MM/AAAA)", "N", 6, False, 0, True),
        campo(3, "ORIG_CRED", "Indicador da origem do crédito: 01 – Crédito decorrente de operações próprias; 02 – Crédito transferido por pessoa jurídica sucedida.", "N", 2, True, 0, True),
        campo(4, "COD_CRED", "Código do Tipo do Crédito, conforme Tabela 4.3.6.", "N", 3, True, 0, True),
        campo(5, "VL_CRED", "Valor do Crédito a Descontar", "N", 0, False, 2, True),
    ], 405)

    # =======================================================================
    # PARTE 3 — nomes de campo repetidos dentro do mesmo registro.
    #
    # Nome repetido quebra o indice O(1) por nome e, na Fase 2, produziria
    # duas colunas com o mesmo cabecalho na aba do Excel — e a reconversao
    # mapeia coluna POR NOME (spec 5.4), entao nao teria como distinguir.
    # =======================================================================

    # 0145, pagina 80 — defeito de EXTRACAO. Os nomes estao quebrados na
    # celula do PDF: "VL_REC" + "_TOT", "COD_IN" + "C_TRIB". A leitura por
    # celula com borda mostra os nomes inteiros, e eles batem com as duas
    # transcricoes independentes do autor.
    substitui("0145", [
        campo(1, "REG", 'Texto fixo contendo "0145".', "C", 4, True, 0, True),
        campo(2, "COD_INC_TRIB", "Código indicador da incidência tributária no período: "
              "1 – Contribuição Previdenciária apurada no período, exclusivamente com base na "
              "Receita Bruta; 2 – Contribuição Previdenciária apurada no período, com base na "
              "Receita Bruta e com base nas Remunerações pagas, na forma dos incisos I e III do "
              "art. 22 da Lei nº 8.212, de 1991.", "N", 1, True, 0, True),
        campo(3, "VL_REC_TOT", "Valor da Receita Bruta Total da Pessoa Jurídica no Período",
              "N", 0, False, 2, True),
        campo(4, "VL_REC_ATIV", "Valor da Receita Bruta da(s) Atividade(s) Sujeita(s) à "
              "Contribuição Previdenciária sobre a Receita Bruta", "N", 0, False, 2, True),
        campo(5, "VL_REC_DEMAIS_ATIV", "Valor da Receita Bruta da(s) Atividade(s) não Sujeita(s) "
              "à Contribuição Previdenciária sobre a Receita Bruta", "N", 0, False, 2, False),
        campo(6, "INFO_COMPL", "Informação complementar", "C", 0, False, 0, False),
    ], 80)

    # M210 e M610 — o GUIA v1.35 ESTA DESATUALIZADO nestes dois.
    #
    # As paginas 310-311 e 344-345 dao 13 campos, terminando em VL_CONT_PER.
    # Mas o arquivo real de dezembro/2021, aprovado pelo PVA, traz 16 — e as
    # duas transcricoes independentes do autor tambem trazem 16, com os tres
    # campos de ajuste da base de calculo que o guia nao tem. O leiaute mudou
    # depois de o guia v1.35 ser publicado, em junho de 2021.
    #
    # Aqui o arquivo aprovado pelo PVA vale mais que o guia: com 13 campos o
    # parser avisaria em toda linha M210 e a Fase 2 geraria 13 colunas para
    # 16 valores, perdendo dado.
    #
    # A extracao original tinha 16 campos, mas os tres ultimos eram
    # repeticao dos campos 11 a 13, pegos da continuacao da tabela na pagina
    # seguinte. Substituidos pelo leiaute de 16 campos de verdade.
    def bloco_m2x0(reg, sufixo, pagina):
        aliq = "PIS/PASEP" if sufixo == "PIS" else "COFINS"
        substitui(reg, [
            campo(1, "REG", f'Texto fixo contendo "{reg}"', "C", 4, True, 0, True),
            campo(2, "COD_CONT", "Código da contribuição social apurada no período, conforme a Tabela 4.3.5.", "C", 2, True, 0, True),
            campo(3, "VL_REC_BRT", "Valor da Receita Bruta", "N", 0, False, 2, True),
            campo(4, "VL_BC_CONT", "Valor da Base de Cálculo da Contribuição", "N", 0, False, 2, True),
            campo(5, f"VL_AJUS_ACRES_BC_{sufixo}", "Valor total dos ajustes de acréscimo da base de cálculo", "N", 0, False, 2, False),
            campo(6, f"VL_AJUS_REDUC_BC_{sufixo}", "Valor total dos ajustes de redução da base de cálculo", "N", 0, False, 2, False),
            campo(7, "VL_BC_CONT_AJUS", "Valor da Base de Cálculo da Contribuição, após ajustes (04 + 05 – 06)", "N", 0, False, 2, True),
            campo(8, f"ALIQ_{sufixo}", f"Alíquota da {aliq} (em percentual)", "N", 8, False, 4, False),
            campo(9, f"QUANT_BC_{sufixo}", f"Quantidade – Base de cálculo {aliq}", "N", 0, False, 3, False),
            campo(10, f"ALIQ_{sufixo}_QUANT", f"Alíquota da {aliq} (em reais)", "N", 0, False, 4, False),
            campo(11, "VL_CONT_APUR", "Valor total da contribuição social apurada", "N", 0, False, 2, True),
            campo(12, "VL_AJUS_ACRES", "Valor total dos ajustes de acréscimo", "N", 0, False, 2, True),
            campo(13, "VL_AJUS_REDUC", "Valor total dos ajustes de redução", "N", 0, False, 2, True),
            campo(14, "VL_CONT_DIFER", "Valor da contribuição a diferir no período", "N", 0, False, 2, False),
            campo(15, "VL_CONT_DIFER_ANT", "Valor da contribuição diferida em períodos anteriores", "N", 0, False, 2, False),
            campo(16, "VL_CONT_PER", "Valor Total da Contribuição do Período (11 + 12 – 13 – 14 + 15)", "N", 0, False, 2, True),
        ], pagina)

    bloco_m2x0("M210", "PIS", 309)
    bloco_m2x0("M610", "COFINS", 343)

    # C170, pagina 118 — DIVERGENCIA DELIBERADA do texto da v1.35.
    #
    # Aqui nao e defeito de extracao: a leitura por celula com borda mostra
    # que o guia v1.35 nomeia mesmo os campos 28 e 34 de "QUANT_BC", os dois.
    # So a descricao distingue (PIS/PASEP e COFINS), e versoes posteriores do
    # guia desambiguaram para QUANT_BC_PIS e QUANT_BC_COFINS.
    #
    # Mantido o nome repetido, o C170 — o registro mais volumoso de qualquer
    # EFD — teria duas colunas "QUANT_BC" na mesma aba do Excel, e a volta
    # para TXT nao saberia qual e qual. Adotados os nomes das versoes
    # posteriores, que e o que a ferramenta precisa e o que o mercado usa.
    corrige("C170", 28, nome="QUANT_BC_PIS")
    corrige("C170", 34, nome="QUANT_BC_COFINS")

    # =======================================================================
    # PARTE 4 — defeitos que o VALIDADOR encontrou (F1-T7).
    #
    # Rodar lib/sped/validator.ts contra a fixture real aprovada pelo PVA
    # acusou 6 erros bloqueantes. Nenhum era bug do validador: eram tamanhos
    # e nomes errados no dicionario, que os criterios de integridade nao
    # alcancam porque sao estruturais. Cada um foi conferido na pagina do
    # guia. Este e o padrao de evidencia mais forte do projeto — arquivo
    # aceito pelo PVA E o guia concordando.
    # =======================================================================

    # 0200, pagina 83: COD_ITEM e C 060, nao C 006. O arquivo real tem codigo
    # de item com 12 caracteres, que o dicionario recusava.
    corrige("0200", 2, tamanho=60)

    # 0200 campo 11: o nome estava COD_LSTA, com um "A" grudado do texto
    # vizinho; o guia diz COD_LST.
    #
    # E o TIPO diverge do guia de proposito. O guia declara N 004, mas os
    # codigos da lista de servicos da LC 116/03 sao escritos com ponto —
    # "1.01", "7.02", "14.01" — e o arquivo aprovado pelo PVA os traz assim,
    # com ate 5 caracteres. Mantido N, o validador acusaria 58 erros
    # bloqueantes num arquivo que a Receita aceitou. Mesma situacao do
    # M210: quando guia e arquivo real divergem, vale o arquivo real.
    corrige(
        "0200", 11,
        nome="COD_LST",
        descricao="Código do serviço conforme lista do Anexo I da Lei Complementar "
        "nº 116/03 (ex.: 1.01, 7.02, 14.01).",
        tipo="C", tamanho=5, tamanho_fixo=False,
    )

    # A010 e D010, paginas 95 e 193: o campo 02 e CNPJ, nao IND_MOV. O
    # IND_MOV vazou do registro de abertura de bloco (A001 e D001), que esta
    # logo acima na mesma pagina. Confirmado tambem pelas duas transcricoes
    # independentes do autor.
    for reg in ("A010", "D010"):
        corrige(
            reg, 2,
            nome="CNPJ",
            descricao="Número de inscrição do estabelecimento no CNPJ.",
            tipo="N", tamanho=14, tamanho_fixo=True, decimais=0, obrigatorio=True,
        )

    # F100, pagina 232: IND_OPER e C 001*, nao N 014*.
    corrige(
        "F100", 2,
        descricao="Indicador do Tipo da Operação: 0 – Aquisição, custos, despesas ou "
        "encargos, ou receitas sujeitas a crédito (CST 50 a 66); 1 – Receita auferida "
        "sujeita ao pagamento (CST 01, 02, 03 ou 05); 2 – Receita auferida não sujeita "
        "ao pagamento (CST 04, 06, 07, 08, 09, 49).",
        tipo="C", tamanho=1, tamanho_fixo=True,
    )

    # M100, pagina 296: COD_CRED e C 003*, nao C 001*.
    corrige("M100", 2, tamanho=3)

    # 0000, campo 13: "IND_NAT_PJSCPSCPSCP" tem texto vizinho da tabela
    # grudado no nome. Achado em F1-T2 e confirmado pelas duas transcricoes
    # do autor. Passa nos criterios de integridade porque e unico e tem forma
    # de identificador — por isso escapou ate agora.
    corrige("0000", 13, nome="IND_NAT_PJ")

    # --- revisao_manual -----------------------------------------------------
    # As 21 pendencias eram de EXTRACAO: campo perdido, nome estilhacado,
    # tipo nao identificado. Todas fechadas, entao o array esvazia.
    #
    # Isto NAO quer dizer dicionario auditado. Os arquivos reais disponiveis
    # exercitam 74 dos 192 registros; os outros 118 sao saida da extracao que
    # ninguem conferiu contra o guia, apenas passam nos criterios de
    # integridade. Ver docs/DICIONARIO-ACHADOS.md.
    dic["revisao_manual"] = []

    # --- totais -------------------------------------------------------------
    dic["total_registros"] = len(regs)
    dic["total_campos"] = sum(len(r["campos"]) for r in regs.values())

    CAMINHO.write_text(
        json.dumps(dic, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n"
    )

    for cod in ["0111","0500","1100","9990","C500","D100","M110","M500","C396","C810","C820","C880","D201","F500","F510","F550","F560","M220","P100","1300","1500","1620","1700"]:
        r = regs[cod]
        nums = [c["num"] for c in r["campos"]]
        seq = nums == list(range(1, len(nums) + 1))
        print(f"  {cod:<6} {len(nums):>2} campos | sequencial: {'sim' if seq else 'NAO'}")
    print(f"\ntotal_registros: {dic['total_registros']} | total_campos: {dic['total_campos']}")


if __name__ == "__main__":
    main()
