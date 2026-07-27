// O TypeScript 6 exige declaracao de modulo para import de efeito colateral
// (TS2882). O Next declara apenas '*.module.css' — ver
// node_modules/next/types/global.d.ts —, entao a folha global importada em
// app/layout.tsx precisa desta declaracao.
declare module '*.css';
