import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'LiGHT Grant System',
  description: 'Dynamic Grant Intelligence, Tracking, and Proposal Automation Hub',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-[var(--surface-base)] text-[var(--ink-primary)] font-sans">
        {children}
      </body>
    </html>
  );
}
