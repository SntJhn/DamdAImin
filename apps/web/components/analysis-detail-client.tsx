'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { AnalysisResource } from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/$/,
  '',
);

export function AnalysisDetailClient({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisResource | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function loadAnalysis() {
      try {
        const session = await authClient.getSession();
        const user = session.data?.user;
        if (!user) {
          router.replace(`/auth/sign-in?next=/analyses/${analysisId}`);
          return;
        }

        if (!user.emailVerified) {
          router.replace(`/auth/verify?email=${encodeURIComponent(user.email)}`);
          return;
        }

        const token = await getAuthToken();
        if (!token) {
          router.replace(`/auth/sign-in?next=/analyses/${analysisId}`);
          return;
        }

        const response = await fetch(`${apiBaseUrl}/analyses/${analysisId}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (response.status === 401) {
          router.replace(`/auth/sign-in?next=/analyses/${analysisId}`);
          return;
        }
        if (response.status === 404) {
          throw new Error('That Analysis could not be found.');
        }
        if (!response.ok) {
          throw new Error('Analysis status is unavailable right now.');
        }

        const body = (await response.json()) as AnalysisResource;
        if (cancelled) return;
        setAnalysis(body);
        setAccountEmail(user.email);

        if (body.status === 'queued' || body.status === 'processing') {
          if (!document.hidden) timeout = setTimeout(() => void loadAnalysis(), 2_000);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : 'Analysis status is unavailable.',
          );
        }
      }
    }

    function handleVisibilityChange() {
      if (!document.hidden) void loadAnalysis();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void loadAnalysis();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [analysisId, router]);

  async function signOut() {
    await authClient.signOut();
    router.replace('/auth/sign-in');
  }

  return (
    <main className="analysis-page">
      <header className="history-header">
        <Link className="brand" href="/history">
          DamdAImin
        </Link>
        <div className="history-account">
          <span>{accountEmail || 'Private account'}</span>
          <button className="text-button" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <section className="analysis-content" aria-labelledby="analysis-result-title">
        <p className="eyebrow">Analysis status</p>
        <h1 id="analysis-result-title">Your signal is being held safely.</h1>
        {error ? (
          <p className="form-message" role="alert">
            {error}
          </p>
        ) : null}
        {analysis ? (
          <div className="analysis-result-card" aria-live="polite">
            <p className="card-kicker">Persisted stage</p>
            <p className="analysis-stage">{analysis.stage}</p>
            <p className="analysis-status-copy">
              {analysis.status === 'queued' || analysis.status === 'processing'
                ? 'Processing continues if you leave this page. This view checks the durable Analysis resource about every two seconds while visible.'
                : null}
              {analysis.status === 'failed'
                ? (analysis.failureMessage ??
                  'The Research System could not complete this Analysis.')
                : null}
              {analysis.status === 'canceled' ? 'This Analysis was canceled.' : null}
            </p>
            {analysis.status === 'completed' && analysis.result?.emotionClassification ? (
              <div className="analysis-classification">
                <p className="card-kicker">Emotion Classification</p>
                <strong>{analysis.result.emotionClassification}</strong>
              </div>
            ) : null}
            <p className="analysis-id">Analysis ID: {analysis.id}</p>
          </div>
        ) : !error ? (
          <p className="loading-state" role="status">
            Checking the persisted Analysis stage…
          </p>
        ) : null}
        <Link className="secondary-button analysis-back" href="/history">
          Return to History
        </Link>
      </section>
    </main>
  );
}
