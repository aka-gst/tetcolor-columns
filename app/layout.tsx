import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Tetcolor — ретро-головоломка',
  description: 'Падающие тройки, смена цветов и каскады в эстетике VGA.',
  icons: {
    icon: '/favicon.svg?v=2',
    shortcut: '/favicon.svg?v=2',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script defer src="/player-name.js" />
        <script defer src="/pulse/script.js" data-website-id="de024048-c4c3-4639-bbdf-808c558f6d71" />
        {children}
      </body>
    </html>
  );
}
