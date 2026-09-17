import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FacturIA - Tesorería Automatizada & CFO Virtual',
  description: 'Plataforma de conciliación y tesorería en tiempo real para PyMEs en México con motor determinista y cumplimiento SAT.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
