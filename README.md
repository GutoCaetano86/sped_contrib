# SPED Converter — EFD-Contribuições

SaaS que converte arquivos da **EFD-Contribuições** (TXT delimitado por `|`) em Excel editável e de volta em TXT válido para o PVA da Receita Federal.

## Estado do projeto

**Fase 0 — planejamento concluído.** Ainda não há código de aplicação; o próximo passo é a Fase 1 (núcleo do parser).

## Estrutura

```
.
├── CLAUDE.md                          # contexto permanente para o Claude Code
├── data/
│   └── layout_efd_contribuicoes.json  # dicionário de leiaute: 192 registros, 1.624 campos
├── docs/
│   ├── SPEC.md                        # especificação técnica completa
│   ├── PROMPTS-CLAUDE-CODE.md         # 16 prompts de desenvolvimento, na ordem
│   └── Guia-Pratico-EFD-Contribuicoes-v1.35.pdf
└── scripts/
    ├── dump_pages.py                  # extração do PDF — fase 1 (texto)
    ├── dump_words.py                  # extração do PDF — fase 1b (posicional)
    └── build_layout.py                # geração do dicionário — fase 2
```

## Por onde começar

1. Leia `docs/SPEC.md` — especificação completa do produto e da arquitetura.
2. Abra o Claude Code na raiz deste projeto e rode `/init`.
3. Siga `docs/PROMPTS-CLAUDE-CODE.md` a partir da tarefa F1-T1.

## Regenerar o dicionário de leiaute

Necessário quando a Receita publicar nova versão do Guia Prático.

```bash
pip install pdfplumber
cd scripts
python dump_pages.py ../docs/Guia-Pratico-EFD-Contribuicoes-v1.35.pdf 60 433 chunks/c1.json
python dump_words.py ../docs/Guia-Pratico-EFD-Contribuicoes-v1.35.pdf 60 433 words/w1.json
python build_layout.py
```

> Em máquinas mais lentas, quebre os intervalos de página em blocos de ~70 páginas.

## Stack prevista

Next.js 15 · React 19 · TypeScript · Tailwind + shadcn/ui · Supabase (Auth + Postgres + Storage) · exceljs · Vitest · Vercel

## Aviso

Ferramenta de conversão de formato. Não presta consultoria fiscal nem valida regras de negócio tributárias. A conferência final da escrituração é responsabilidade do usuário.
