import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FacturIA · Movimientos y documentos',
  description: 'Carga tus documentos y los movimientos de tu banco para revisar qué factura corresponde a cada entrada o salida de dinero.',
};
export const viewport: Viewport = {width: 'device-width', initialScale: 1};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full">
      <body className="h-full bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
