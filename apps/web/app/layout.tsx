import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'DamdAImin',
  description: 'Explainable speech-emotion classification research application.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
