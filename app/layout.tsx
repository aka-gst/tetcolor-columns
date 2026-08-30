import type { Metadata, Viewport } from 'next';
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

/* Игра управляется тапами и протяжками по полю, поэтому масштабирование
   выключено: случайный двойной тап иначе увеличивает стакан посреди партии, и
   выйти обратно, не отпустив фигуру, некуда. Линии выключили его давно, а тут
   он оставался включённым. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#05050a',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        {/* The site's own menu stylesheet, served from the root and shared with
            the other games. It is deliberately not bundled: it belongs to the
            site, not to this app, and must stay one cached copy for all of them. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/game-menu.css?v=1" />
        {/* Relative hrefs so install works under the /tetcolor/ prefix the proxy serves. */}
        <link rel="manifest" href="manifest.webmanifest?v=1" />
        <link rel="apple-touch-icon" href="icon-192.png" />
        <meta name="theme-color" content="#05050a" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://aka-gst.ru/tetcolor/" />
        <meta property="og:title" content="Tetcolor — ретро-головоломка" />
        <meta property="og:description" content="Падающие тройки, смена цветов и каскады в эстетике VGA." />
        <meta property="og:image" content="https://aka-gst.ru/tetcolor/og.jpg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://aka-gst.ru/tetcolor/og.jpg" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Tetcolor" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script defer src="/player-name.js?v=3" />
        <script defer src="/tour.js?v=1" />
        <script defer src="/pulse/script.js" data-website-id="de024048-c4c3-4639-bbdf-808c558f6d71" />
        {children}
      </body>
    </html>
  );
}
