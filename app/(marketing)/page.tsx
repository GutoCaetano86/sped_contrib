// Landing. Ver docs/SPEC.md secao 7.1.
//
// A objecao central deste publico nao e preco nem funcionalidade: e "por que
// eu confiaria meu arquivo fiscal a voces?". Um TXT da EFD tem faturamento,
// base de calculo, participantes e CNPJ. Por isso a secao de dados vem ANTES
// dos planos, com numeros concretos (retencao por plano, exclusao permanente,
// finalidade unica) em vez de adjetivos.
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Lock,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PLANOS, type Plano } from '@/lib/plans';
import { formatarBytes } from '@/lib/formato';

export const metadata: Metadata = {
  title: 'SPED Converter — edite sua EFD-Contribuições no Excel',
  description:
    'Converta o TXT da EFD-Contribuições em planilha editável e de volta em arquivo válido para o PVA. Seus dados fiscais não são usados para nenhuma outra finalidade.',
};

const PASSOS = [
  {
    icone: Upload,
    titulo: 'Envie o TXT',
    texto:
      'O mesmo arquivo que você entrega ao PVA. Lemos o registro 0000 e mostramos CNPJ e período para você conferir antes de converter.',
  },
  {
    icone: FileSpreadsheet,
    titulo: 'Edite no Excel',
    texto:
      'Uma aba por tipo de registro, colunas com o nome oficial do leiaute. Na aba dos itens, as primeiras colunas repetem a nota a que cada um pertence.',
  },
  {
    icone: Download,
    titulo: 'Baixe o TXT de volta',
    texto:
      'Totalizadores e base de cálculo do crédito recalculados. Sem edição, o arquivo volta idêntico ao original — byte a byte.',
  },
];

const ORDEM: Plano[] = ['free', 'pro', 'escritorio'];

/** Retenção em palavras. O plano guarda dias; "24 horas" lê melhor que "1 dia". */
const RETENCAO: Record<Plano, string> = {
  free: '24 horas',
  pro: '30 dias',
  escritorio: '90 dias',
};

const FAQ = [
  {
    pergunta: 'Vocês olham o conteúdo do meu arquivo?',
    resposta:
      'Não. O arquivo é processado para gerar a planilha e o TXT de volta, e nada mais. Nossos registros de operação guardam apenas identificador, contagem de linhas e duração — nunca o conteúdo fiscal.',
  },
  {
    pergunta: 'Meus dados treinam algum modelo de IA?',
    resposta:
      'Não. Seus arquivos não são usados para treinar modelos, não são vendidos, não são compartilhados com terceiros e não alimentam nenhuma base analítica.',
  },
  {
    pergunta: 'Outro usuário pode ver meus arquivos?',
    resposta:
      'Não. O isolamento é feito no banco de dados, por política de linha, e no armazenamento, por pasta com o seu identificador. Uma requisição pedindo arquivo de outra conta recebe “não encontrado” — nem confirmamos que o arquivo existe.',
  },
  {
    pergunta: 'Por quanto tempo vocês guardam?',
    resposta:
      'Pelo prazo do seu plano: 24 horas no gratuito, 30 dias no Pro e 90 dias no Escritório. Passado o prazo, um processo diário apaga o arquivo. Você também pode excluir na hora, pelo botão do painel.',
  },
  {
    pergunta: 'O TXT que sai é aceito pelo PVA?',
    resposta:
      'É o critério de aceite do produto, e testamos contra o PVA oficial da Receita. Encoding ISO-8859-1, quebra CRLF e todos os totalizadores são recalculados. Quando a planilha tem erro que invalidaria o arquivo, bloqueamos a geração em vez de entregar algo que o PVA recusa.',
  },
  {
    pergunta: 'E se eu apagar itens de uma nota?',
    resposta:
      'A base de cálculo do crédito nos registros M105 e M505 é recalculada a partir dos documentos, junto com a cadeia até a contribuição a recolher. O sistema avisa quando isso altera o valor devido, para você conferir antes de transmitir.',
  },
];

export default function LandingPage() {
  return (
    <main>
      {/* ------------------------------------------------------------ hero */}
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Edite seu SPED no Excel. Sem quebrar o arquivo.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          A EFD-Contribuições vira uma planilha com uma aba por registro e colunas nomeadas
          conforme o leiaute oficial. Você corrige no Excel e recebe de volta um TXT válido para
          o PVA.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/cadastro">
              Converter um arquivo
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#dados">Como cuidamos dos seus dados</Link>
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          3 conversões por mês no plano gratuito. Sem cartão.
        </p>
      </section>

      {/* --------------------------------------------------------- 3 passos */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold">Três passos</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {PASSOS.map((passo, i) => (
              <li key={passo.titulo}>
                <passo.icone className="size-6 text-muted-foreground" aria-hidden />
                <h3 className="mt-3 font-medium">
                  <span className="text-muted-foreground">{i + 1}. </span>
                  {passo.titulo}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{passo.texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ dados */}
      <section id="dados" className="scroll-mt-16 border-t">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold">Seu arquivo é dado fiscal sigiloso</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Um TXT da EFD tem faturamento, base de cálculo, participantes e CNPJ. Tratamos como
            tal — e preferimos dizer exatamente o que fazemos a prometer segurança no abstrato.
          </p>

          <dl className="mt-10 grid gap-8 sm:grid-cols-3">
            <div>
              <dt className="flex items-center gap-2 font-medium">
                <Clock className="size-5 text-muted-foreground" aria-hidden />
                Prazo curto e declarado
              </dt>
              <dd className="mt-2 text-sm text-muted-foreground">
                24 horas no gratuito, 30 dias no Pro, 90 dias no Escritório. Passado o prazo, um
                processo diário apaga o arquivo. Não guardamos “por precaução”.
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 font-medium">
                <Trash2 className="size-5 text-muted-foreground" aria-hidden />
                Exclusão quando você quiser
              </dt>
              <dd className="mt-2 text-sm text-muted-foreground">
                O botão “excluir” do painel remove o arquivo do armazenamento e do banco na hora.
                Não é arquivamento nem lixeira.
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 font-medium">
                <Lock className="size-5 text-muted-foreground" aria-hidden />
                Uma finalidade só
              </dt>
              <dd className="mt-2 text-sm text-muted-foreground">
                Converter o seu arquivo. Não treinamos modelos com ele, não vendemos, não
                compartilhamos e não montamos base analítica.
              </dd>
            </div>
          </dl>

          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {[
              'Buckets privados: o acesso é por link assinado que expira em 5 minutos',
              'Isolamento por política de linha no banco, não por filtro na aplicação',
              'Criptografia em trânsito (HTTPS) e em repouso (AES-256)',
              'Registros de operação sem conteúdo fiscal: só identificador e métricas',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-sm">
            <Link href="/privacidade" className="font-medium underline underline-offset-4">
              Leia a política de privacidade completa
            </Link>
          </p>
        </div>
      </section>

      {/* ----------------------------------------------------------- planos */}
      <section id="planos" className="scroll-mt-16 border-t bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold">Planos</h2>
          <p className="mt-3 text-muted-foreground">
            A retenção faz parte do plano — é quanto tempo o arquivo fica guardado antes de ser
            apagado automaticamente.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {ORDEM.map((chave) => {
              const plano = PLANOS[chave];
              const destaque = chave === 'pro';
              return (
                <div
                  key={chave}
                  className={`rounded-lg border p-6 ${destaque ? 'border-foreground' : ''}`}
                >
                  <h3 className="font-medium">{plano.rotulo}</h3>
                  <p className="mt-2">
                    <span className="text-3xl font-bold">
                      {plano.precoMensalReais === 0 ? 'R$ 0' : `R$ ${plano.precoMensalReais}`}
                    </span>
                    <span className="text-sm text-muted-foreground">/mês</span>
                  </p>
                  <ul className="mt-6 space-y-2 text-sm">
                    <Item>{plano.conversoesPorMes} conversões por mês</Item>
                    <Item>Até {formatarBytes(plano.tamanhoMaximoBytes)} por arquivo</Item>
                    <Item>Arquivos guardados por {RETENCAO[chave]}</Item>
                  </ul>
                  <Button
                    asChild
                    className="mt-6 w-full"
                    variant={destaque ? 'default' : 'outline'}
                  >
                    <Link href="/cadastro">
                      {plano.precoMensalReais === 0 ? 'Começar de graça' : 'Assinar'}
                    </Link>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- FAQ */}
      <section className="border-t">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold">Perguntas frequentes</h2>
          <dl className="mt-8 space-y-8">
            {FAQ.map((item) => (
              <div key={item.pergunta}>
                <dt className="font-medium">{item.pergunta}</dt>
                <dd className="mt-2 text-sm text-muted-foreground">{item.resposta}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-12 rounded-lg border p-6 text-center">
            <p className="font-medium">Converta um arquivo e veja a planilha.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Três conversões no plano gratuito, sem cartão.
            </p>
            <Button asChild className="mt-4">
              <Link href="/cadastro">
                Criar conta
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
