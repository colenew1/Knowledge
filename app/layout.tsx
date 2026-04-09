import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'RFP Knowledge Base',
  description: 'Upload RFPs, draft grounded answers, export filled xlsx.',
};

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/kb', label: 'Knowledge Base' },
  { href: '/fill', label: 'Fill Jobs' },
  { href: '/ask', label: 'Ask' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              RFP Knowledge Base
            </Link>
            <nav className="flex gap-6 text-sm text-stone-600">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hover:text-stone-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
