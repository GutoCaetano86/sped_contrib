'use client';

// Barra de cota do plano (spec 7.2) e o estado "cota esgotada" com CTA de
// upgrade (spec 7.5).
import Link from 'next/link';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatarBytes, formatarNumero } from '@/lib/formato';

export interface Cota {
  plano: string;
  conversoes_no_mes: number;
  limite_mensal: number;
  restantes: number;
  tamanho_maximo_bytes: number;
  retencao_dias: number;
}

export function BarraCota({ cota }: { cota: Cota }) {
  const usado = Math.min(100, (cota.conversoes_no_mes / cota.limite_mensal) * 100);
  const esgotada = cota.restantes === 0;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          Plano {cota.plano}
          <span className="ml-2 font-normal text-muted-foreground">
            {formatarNumero(cota.conversoes_no_mes)} de {formatarNumero(cota.limite_mensal)}{' '}
            conversões neste mês
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          até {formatarBytes(cota.tamanho_maximo_bytes)} por arquivo · guardados por{' '}
          {cota.retencao_dias} {cota.retencao_dias === 1 ? 'dia' : 'dias'}
        </p>
      </div>

      <Progress
        value={usado}
        className="mt-3"
        aria-label={`${formatarNumero(cota.conversoes_no_mes)} de ${formatarNumero(cota.limite_mensal)} conversões usadas`}
      />

      {esgotada ? <AvisoCotaEsgotada cota={cota} /> : null}
    </div>
  );
}

/** Estado exigido pela spec 7.5: cota esgotada com CTA de upgrade. */
export function AvisoCotaEsgotada({ cota }: { cota: Cota }) {
  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTitle>Cota do mês esgotada</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          Você usou as {formatarNumero(cota.limite_mensal)} conversões do plano {cota.plano}. A
          cota volta no dia 1º; para converter agora, mude de plano.
        </span>
        <Button asChild size="sm">
          <Link href="/#planos">Ver planos</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
