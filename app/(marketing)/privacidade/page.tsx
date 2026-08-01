// Politica de privacidade. Ver docs/SPEC.md secao 8.
//
// Exigida ali como "pagina /privacidade declarando finalidade, retencao e nao
// uso dos dados para treinar modelos". Escrita em portugues direto: o publico
// e contador, nao advogado, e um texto que ninguem le nao protege ninguem.
//
// Os prazos saem de lib/plans.ts para nao divergirem do que o codigo aplica.
import type { Metadata } from 'next';
import Link from 'next/link';
import { PLANOS, type Plano } from '@/lib/plans';
import { formatarBytes } from '@/lib/formato';

export const metadata: Metadata = {
  title: 'Privacidade e dados — SPED Converter',
  description:
    'O que fazemos com o arquivo da sua EFD-Contribuições: finalidade única, prazo de retenção por plano, exclusão permanente sob demanda e não uso para treinar modelos.',
};

const ORDEM: Plano[] = ['free', 'pro', 'escritorio'];

const RETENCAO: Record<Plano, string> = {
  free: '24 horas',
  pro: '30 dias',
  escritorio: '90 dias',
};

/** Data da última revisão do texto. */
const ATUALIZADO_EM = '1º de agosto de 2026';

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Privacidade e dados</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Atualizada em {ATUALIZADO_EM}
      </p>

      <p className="mt-8 text-lg">
        O arquivo da EFD-Contribuições contém faturamento, base de cálculo, participantes e CNPJ.
        É dado sigiloso, e esta página diz exatamente o que fazemos com ele — sem termo
        genérico que sirva para justificar qualquer coisa depois.
      </p>

      <Secao titulo="O que coletamos">
        <p>Duas coisas, e só:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong>Dados de conta:</strong> e-mail, nome e — se você entrar com Google — o nome
            e a foto que o Google devolve. Servem para autenticar e para saber de quem é cada
            arquivo.
          </li>
          <li>
            <strong>Os arquivos que você envia</strong> e os que geramos a partir deles. Do
            registro 0000 extraímos CNPJ, razão social e período, para você reconhecer o arquivo
            na lista.
          </li>
        </ul>
        <p className="mt-3">
          Não pedimos CPF, telefone, endereço nem dados de pagamento — a cobrança do MVP é
          manual e não passa por aqui.
        </p>
      </Secao>

      <Secao titulo="Para que usamos">
        <p>
          <strong>Uma finalidade só: converter o seu arquivo</strong> e devolvê-lo a você. Isso
          significa ler o TXT, gerar a planilha, ler a planilha de volta, recalcular
          totalizadores e base de cálculo do crédito, e gerar o TXT final.
        </p>
        <p className="mt-3">Fora disso, declaradamente:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong>não</strong> usamos seus arquivos para treinar modelos de inteligência
            artificial, nossos ou de terceiros;
          </li>
          <li>
            <strong>não</strong> vendemos, alugamos nem cedemos seus dados;
          </li>
          <li>
            <strong>não</strong> montamos base analítica, estatística de mercado ou qualquer
            agregado a partir do conteúdo fiscal;
          </li>
          <li>
            <strong>não</strong> usamos seus dados para publicidade.
          </li>
        </ul>
      </Secao>

      <Secao titulo="Por quanto tempo guardamos">
        <p>
          Pelo prazo do seu plano. Passado esse prazo, um processo diário apaga o arquivo do
          armazenamento — não é arquivamento, é exclusão.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">Plano</th>
                <th className="py-2 pr-4 font-medium">Retenção</th>
                <th className="py-2 font-medium">Tamanho máximo</th>
              </tr>
            </thead>
            <tbody>
              {ORDEM.map((chave) => (
                <tr key={chave} className="border-b last:border-0">
                  <td className="py-2 pr-4">{PLANOS[chave].rotulo}</td>
                  <td className="py-2 pr-4">{RETENCAO[chave]}</td>
                  <td className="py-2">{formatarBytes(PLANOS[chave].tamanhoMaximoBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4">
          Os registros de conversão — data, duração, contagem de linhas, erros e avisos — ficam
          associados à sua conta enquanto ela existir. <strong>Eles não contêm conteúdo
          fiscal</strong>: nunca gravamos valores, participantes ou linhas do arquivo em log.
        </p>
      </Secao>

      <Secao titulo="Exclusão permanente, quando você quiser">
        <p>
          Cada arquivo do painel tem o botão <strong>excluir</strong>. Ele remove o objeto do
          armazenamento e a linha do banco na mesma operação. Não há lixeira e não há como
          desfazer.
        </p>
        <p className="mt-3">
          Para apagar a conta inteira, com todos os arquivos e conversões, escreva para o
          contato no fim desta página. Fazemos em até 7 dias e confirmamos por e-mail.
        </p>
      </Secao>

      <Secao titulo="Quem consegue ver">
        <p>
          Só você. O isolamento não depende de a aplicação lembrar de filtrar — está no banco de
          dados, em política de linha que compara o dono do registro com quem fez a requisição, e
          no armazenamento, em política de pasta por identificador de usuário.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Os buckets são privados; a leitura é por link assinado que expira em 5 minutos.</li>
          <li>
            Uma requisição pedindo arquivo de outra conta recebe <em>não encontrado</em> — não
            confirmamos sequer que o arquivo existe, porque isso já seria informação sobre a
            conta alheia.
          </li>
          <li>Tráfego por HTTPS; armazenamento cifrado em repouso com AES-256.</li>
        </ul>
      </Secao>

      <Secao titulo="Com quem compartilhamos">
        <p>
          Com os provedores de infraestrutura necessários para o serviço funcionar, e nada além:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase</strong> — banco de dados, autenticação e armazenamento dos
            arquivos.
          </li>
          <li>
            <strong>Vercel</strong> — hospedagem da aplicação.
          </li>
          <li>
            <strong>Google</strong> — apenas se você optar por entrar com a conta Google, e só
            para autenticar.
          </li>
        </ul>
        <p className="mt-3">
          Eles processam dados por nossa conta e sob contrato. Fora isso, só compartilhamos
          mediante ordem judicial ou requisição legal a que sejamos obrigados a atender.
        </p>
      </Secao>

      <Secao titulo="Seus direitos (LGPD)">
        <p>
          A Lei Geral de Proteção de Dados garante a você confirmar se tratamos seus dados,
          acessá-los, corrigi-los, pedir que sejam anonimizados, bloqueados ou eliminados, pedir
          portabilidade e revogar o consentimento.
        </p>
        <p className="mt-3">
          Acesso e exclusão você exerce sozinho, pelo painel. Para o resto, use o contato abaixo.
        </p>
      </Secao>

      <Secao titulo="Cookies">
        <p>
          Usamos apenas os cookies necessários para manter você autenticado. Não há cookie de
          publicidade, de rastreamento entre sites nem de análise comportamental — por isso não
          existe banner de consentimento aqui.
        </p>
      </Secao>

      <Secao titulo="Contato">
        <p>
          Dúvida sobre esta política, pedido de exclusão de conta ou exercício de direito da
          LGPD:{' '}
          <a
            href="mailto:privacidade@spedconverter.com.br"
            className="font-medium underline underline-offset-4"
          >
            privacidade@spedconverter.com.br
          </a>
          .
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Se mudarmos esta política, a data no topo muda junto e avisamos por e-mail quando a
          mudança afetar como tratamos arquivos já enviados.
        </p>
      </Secao>

      <p className="mt-12 text-sm">
        <Link href="/" className="font-medium underline underline-offset-4">
          Voltar para a página inicial
        </Link>
      </p>
    </main>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold">{titulo}</h2>
      <div className="mt-3 space-y-0 text-muted-foreground">{children}</div>
    </section>
  );
}
