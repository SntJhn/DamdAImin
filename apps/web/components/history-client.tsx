'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { authClient } from '../lib/auth-client';

interface HistoryItem {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: string;
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/$/,
  '',
);

export function HistoryClient() {
  const router = useRouter();
  const [analyses, setAnalyses] = useState<HistoryItem[]>([]);
  const [accountEmail, setAccountEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const session = await authClient.getSession();
        const user = session.data?.user;
        if (!user) {
          router.replace('/auth/sign-in?next=/history');
          return;
        }

        if (!user.emailVerified) {
          router.replace(`/auth/verify?email=${encodeURIComponent(user.email)}`);
          return;
        }

        const tokenResponse = await authClient.token();
        const token = tokenResponse.data?.token;
        if (!token) {
          router.replace('/auth/sign-in?next=/history');
          return;
        }

        const response = await fetch(`${apiBaseUrl}/analyses`, {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        if (response.status === 401) {
          router.replace('/auth/sign-in?next=/history');
          return;
        }

        if (!response.ok) {
          throw new Error('history request failed');
        }

        const body = (await response.json()) as { analyses?: HistoryItem[] };
        if (!cancelled) {
          setAnalyses(Array.isArray(body.analyses) ? body.analyses : []);
          setAccountEmail(user.email);
        }
      } catch {
        if (!cancelled) {
          setError('History is unavailable right now. Refresh to try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    await authClient.signOut();
    router.replace('/auth/sign-in');
  }

  return (
    <main className="history-page">
      <header className="history-header">
        <a className="brand" href="/">
          DamdAImin
        </a>
        <div className="history-account">
          <span>{accountEmail || 'Private account'}</span>
          <button className="text-button" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <section className="history-content" aria-labelledby="history-title">
        <div className="history-heading">
          <p className="eyebrow">Analysis History</p>
          <h1 id="history-title">Your signal archive.</h1>
          <p>Queued, processing, failed, and completed analyses will appear here, newest first.</p>
        </div>
        {loading ? (
          <p className="loading-state" role="status">
            Checking your history…
          </p>
        ) : null}
        {error ? (
          <p className="form-message" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && analyses.length === 0 ? (
          <div className="empty-history" role="status">
            <div className="empty-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="card-kicker">No analyses yet</p>
            <h2>Your first reading will live here.</h2>
            <p>
              When you submit one utterance for analysis, its persisted progress and result will
              stay attached to this account.
            </p>
          </div>
        ) : null}
        {!loading && !error && analyses.length > 0 ? (
          <ul className="history-list">
            {analyses.map((analysis) => (
              <li key={analysis.id}>
                <span>{analysis.status}</span>
                <time dateTime={analysis.createdAt}>
                  {new Date(analysis.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
