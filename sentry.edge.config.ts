// Sentry no runtime Edge (o middleware roda aqui).
import * as Sentry from '@sentry/nextjs';
import { opcoesComuns } from '@/lib/observabilidade';

Sentry.init(opcoesComuns);
