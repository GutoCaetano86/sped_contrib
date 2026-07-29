# Estado real do dicionário de leiaute (achados de F1-T2 e F1-T3)

> Alvo do projeto: **Guia Prático da EFD-Contribuições v1.35**, confirmado.
> O guia é a única autoridade. Tudo mais é indício.

## Resumo

O `revisao_manual` de `data/layout_efd_contribuicoes.json` lista 21 registros
pendentes. **Esse número subestima muito o problema.** Cruzando o dicionário
com duas transcrições independentes do autor (ver "Fontes de contraprova"),
dos 119 registros verificáveis o dicionário **acerta 70 e erra 49** — 41%.

## 1. A `revisao_manual` não enxerga campo faltando no fim da tabela

A detecção de lacunas só procura buraco *interno* na numeração. Um registro
truncado no fim continua com numeração 1..N "sequencial", com N pequeno
demais. Confirmado lendo o guia:

| Registro | motivo registrado | falta de verdade |
| --- | --- | --- |
| `C820` | `[5, 10]` | 5, 10 e **13** |
| `C880` | `[6]` | 6 e **14** |
| `D201` | `[2]` | 1, 2 e **7** |
| `F500` | `[3, 13]` | 3, 13 e **16** |

**Consequência para o teste de integridade:** os três critérios pedidos
(numeração 1..N, campo 01 = `REG`, tipo `C`/`N`) *não detectam* isso. Nem
detectam nome corrompido — passariam num registro com campos chamados `XA`,
`ANT` e `S`. Daí o teste incluir também sanidade de nome.

## 2. Três classes de defeito, não uma

**a) Nome estilhaçado.** O parser posicional concatenava fragmento de nome no
campo anterior quando a linha do número e a do nome não coincidiam em Y:

    F510  1:REGVL_REC_CAI  2:XA  4:VL_DESC_PISQUANT_BC_P  5:ISALIQ_PIS_QU  6:ANT
    F500  1:REGVL_REC_CAIXA  8:CST_COFINSVL_DESC_COFIN  9:S
    C880  5:VL_DESCCST_PIS  13:VL_COFINSCOD_CTA
    0000  13:IND_NAT_PJSCPSCPSCP   (correto: IND_NAT_PJ)

**b) Campo descartado.** O regex de nome aceitava só `[A-Z0-9_]`, então
sumiam `NÍVEL` (campo 05 do `0500`, com acento) e `TP_CT-e` (campo 13 do
`D100`, com minúscula e hífen).

**c) Vazamento entre registros.** Campos de um registro aparecem em outro:

| Registro | Correto | No dicionário |
| --- | --- | --- |
| `0100` #2–4 | `NOME`, `CPF`, `CRC` | `COD_SCP`, `DESC_SCP`, `INF_COMP` (do `0035`) |
| `0900` #2–4 | `REC_TOTAL_BLOCO_A`… | `DT_ALT`, `COD_CCUS`, `CCUS` (do `0500`/`0600`) |
| `0450` #2–3 | `COD_INF`, `TXT` | `COD_NAT`, `DESCR_NAT` (do `0400`) |

## 3. Duplicata de nome = linha repetida, não nome truncado

Correção de uma conclusão anterior. O `M210` tem `VL_CONT_DIFER` três vezes
no dicionário. **Não são campos distintos com nome truncado.** A tabela do
`M210` continua na página 311, que repete o cabeçalho e as linhas 12–13, e o
extrator anexou as repetições como campos 14, 15 e 16.

O guia v1.35 dá 13 campos ao `M210`, terminando em `VL_CONT_PER`; o
dicionário tem 16. A correção é **descartar as duplicatas**. Vale igual para
o `M610`. Mesmo raciocínio deve ser checado em `0145` e `C170`.

## 3b. O Guia v1.35 está DESATUALIZADO em pelo menos dois registros

Descoberto ao fechar F1-T3, e é o achado que mais muda a hierarquia de
fontes.

O `M210` e o `M610` têm **13 campos** nas tabelas do guia (páginas 310-311 e
344-345), terminando em `VL_CONT_PER`. Mas o arquivo real de **dezembro de
2021, aprovado pelo PVA**, traz **16** — os três a mais são
`VL_AJUS_ACRES_BC_PIS`, `VL_AJUS_REDUC_BC_PIS` e `VL_BC_CONT_AJUS`, ajustes
da base de cálculo. O leiaute mudou depois de o guia v1.35 ser publicado, em
junho de 2021.

**Hierarquia de autoridade, nesta ordem:**

1. arquivo real aprovado pelo PVA — é o que decide se o arquivo passa;
2. transcrições do autor (JS e XLSM) — batem com o real onde há sobreposição;
3. Guia Prático v1.35 — completo e preciso na maioria, mas pode estar velho.

Ficou registrado no `aplica_correcoes.py`: manter 13 campos no `M210` faria
o parser avisar em toda linha e a Fase 2 gerar 13 colunas para 16 valores,
perdendo dado.

## 4. Fontes de contraprova — úteis, mas de outra versão

Dois projetos anteriores do autor transcrevem o leiaute de forma
independente:

| Fonte | Onde | Cobertura |
| --- | --- | --- |
| JS | `Pagina-Converter-Sped/js/script.js`, arrays `headersR<REG>` | 127 registros |
| XLSM | `EFDContrib.xlsm`, linha 2 de cada aba | 128 registros |

**As duas concordam entre si em 100% dos 119 registros que têm em comum** —
zero divergência. Isso as torna um detector muito bom.

**Mas elas não são a v1.35.** O `M210` delas tem `VL_AJUS_ACRES_BC_PIS`,
`VL_AJUS_REDUC_BC_PIS` e `VL_BC_CONT_AJUS`, campos acrescentados em versão
posterior do leiaute e ausentes no guia v1.35. Aplicar os nomes delas em
massa injetaria campos de outra versão no dicionário — erro que faz o PVA
rejeitar o arquivo.

**Regra de uso:** divergência entre fontes e dicionário significa "conferir
esta página do guia", nunca "substituir por este nome". Divergência em 1–2
campos costuma ser corrupção da extração (aplicar após conferir);
divergência em muitos campos costuma ser deriva de versão (ignorar).

Cobertura: as fontes não alcançam 73 dos 192 registros — o bloco `P`
inteiro, o bloco `1` inteiro, o bloco `9` inteiro, `F500`–`F560` e
`C800`–`C890`.

## 5. Registros fora de escopo

Só 4 registros do guia são marcados "não disponível para escrituração no
PVA": `C800`, `C810`, `C820`, `C830`. Eles nunca aparecem num TXT real.
Dos pendentes, isso dispensa `C810` e `C820` — sobram 19, que é o número
que a spec §10 já citava (o array tem 21).

## 6. Ferramentas

    python scripts/conferencia/tabela_guia.py --acha M210    # acha a pagina
    python scripts/conferencia/tabela_guia.py 310-311        # le a tabela
    node   scripts/conferencia/compara_fontes.mjs            # cruza com JS+XLSM

`tabela_guia.py` tem dois modos porque nenhum serve para todas as páginas:
`--borda` (padrão) lê a célula delimitada e traz o nome inteiro, mas falha
onde a tabela não tem borda desenhada; `--posicional` sempre funciona, mas
exige leitura humana.

Para achar a página de um registro, use a âncora `Texto fixo contendo
"XXXX"` — procurar por `Registro XXXX:` cai em referência cruzada em prosa.
