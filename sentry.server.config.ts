// Sentry no runtime Node. Carregado por instrumentation.ts.
import * as Sentry from '@sentry/nextjs';
import { opcoesComuns } from '@/lib/observabilidade';

Sentry.init(opcoesComuns);
