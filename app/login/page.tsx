'use client';
import { useState } from 'react';
import { api } from '@/lib/client';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', json: { email, password, invite } });
      location.href = '/';
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main>
      <form className="auth panel" onSubmit={submit}>
        <h1>Kioku</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {mode === 'login' ? 'Sign in to sync your decks.' : 'Create your account.'}
        </p>
        <label>Email</label>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        {mode === 'signup' && (
          <>
            <label>Invite code</label>
            <input type="text" autoCapitalize="off" value={invite} onChange={(e) => setInvite(e.target.value)} />
          </>
        )}
        {err && <div className="err">{err}</div>}
        <div style={{ marginTop: 20 }} className="row">
          <button className="btn primary grow" disabled={busy}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </div>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
          {mode === 'login' ? 'New here? ' : 'Have an account? '}
          <a
            href="#"
            style={{ color: 'var(--accent)' }}
            onClick={(e) => {
              e.preventDefault();
              setErr('');
              setMode(mode === 'login' ? 'signup' : 'login');
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </a>
        </p>
      </form>
    </main>
  );
}
