'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/', 'Decks'],
  ['/add', 'Add'],
  ['/browse', 'Browse'],
  ['/import', 'Import'],
] as const;

export default function TopBar({ title }: { title?: string }) {
  const path = usePathname();
  return (
    <header className="top">
      <h1>{title ? title : <span className="brand">Kioku</span>}</h1>
      <nav>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={path === href ? 'on' : ''}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
