'use client';
import { Suspense, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import NoteEditor from '@/components/NoteEditor';

function Inner({ id }: { id: string }) {
  const router = useRouter();
  const back = useSearchParams().get('back') || '/browse';
  return <NoteEditor noteId={id} onSaved={() => router.push(back)} />;
}

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <TopBar title="Edit note" />
      <main>
        <Suspense>
          <Inner id={id} />
        </Suspense>
      </main>
    </>
  );
}
