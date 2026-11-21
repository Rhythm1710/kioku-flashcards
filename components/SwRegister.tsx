'use client';
import { useEffect } from 'react';
import { flush } from '@/lib/client';

export default function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    flush();
    const on = () => flush();
    window.addEventListener('online', on);
    document.addEventListener('visibilitychange', on);
    return () => {
      window.removeEventListener('online', on);
      document.removeEventListener('visibilitychange', on);
    };
  }, []);
  return null;
}
