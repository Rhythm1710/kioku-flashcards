'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import NoteEditor from '@/components/NoteEditor';

function Inner() {
  const deck = useSearchParams().get('deck') || undefined;
  return <NoteEditor initialDeck={deck} />;
}

export default function AddPage() {
  return (
    <>
      <TopBar title="Add cards" />
      <main>
        <Suspense>
          <Inner />
        </Suspense>
      </main>
    </>
  );
}
