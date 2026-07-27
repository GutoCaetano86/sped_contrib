import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SPED Converter — EFD-Contribuições',
  description:
    'Edite sua EFD-Contribuições no Excel e reconverta em TXT válido para o PVA da Receita Federal.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
