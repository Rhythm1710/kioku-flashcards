import type { Metadata, Viewport } from 'next';
import './globals.css';
import SwRegister from '@/components/SwRegister';

export const metadata: Metadata = {
  title: 'Kioku',
  description: 'Spaced repetition flashcards',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Kioku', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#151614' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
