'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type {
  AnalysisHistoryItem,
  AnalysisHistoryQuery,
  AnalysisHistoryResponse,
} from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v2').replace(
  /\/$/,
  '',
);

type HistoryResultFilter = NonNullable<AnalysisHistoryQuery['result']>;

interface HistoryFilterState {
  search: string;
  status: AnalysisHistoryItem['status'] | '';
  result: HistoryResultFilter | '';
  language: AnalysisHistoryItem['language'] | '';
  from: string;
  to: string;
}

const emptyFilters: HistoryFilterState = {
  search: '',
  status: '',
  result: '',
  language: '',
  from: '',
  to: '',
};

export function HistoryClient() {
  const router = useRouter();
  const [analyses, setAnalyses] = useState<AnalysisHistoryItem[]>([]);
  const [accountEmail, setAccountEmail] = useState('');
  const [draftFilters, setDraftFilters] = useState<HistoryFilterState>(emptyFilters);
  const [activeFilters, setActiveFilters] = useState<HistoryFilterState>(emptyFilters);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoading(true);
      setError('');
      setAnalyses([]);
      setHasMore(false);

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

        const token = await getAuthToken();
        if (!token) {
          router.replace('/auth/sign-in?next=/history');
          return;
        }

        const response = await fetch(buildHistoryUrl(activeFilters), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        if (response.status === 401) {
          router.replace('/auth/sign-in?next=/history');
          return;
        }

        if (!response.ok) {
          throw new Error(
            response.status === 400
              ? 'Those History filters are not valid. Adjust them and try again.'
              : 'History is unavailable right now. Refresh to try again.',
          );
        }

        const body = (await response.json()) as Partial<AnalysisHistoryResponse>;
        if (!cancelled) {
          setAnalyses(Array.isArray(body.analyses) ? body.analyses : []);
          setHasMore(body.hasMore === true);
          setAccountEmail(user.email);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'History is unavailable right now. Refresh to try again.',
          );
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
  }, [activeFilters, reloadToken, router]);

  function updateFilter<Key extends keyof HistoryFilterState>(
    key: Key,
    value: HistoryFilterState[Key],
  ) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveFilters({ ...draftFilters, search: draftFilters.search.trim() });
  }

  function clearFilters() {
    setDraftFilters(emptyFilters);
    setActiveFilters(emptyFilters);
  }

  async function signOut() {
    await authClient.signOut();
    router.replace('/auth/sign-in');
  }

  const filtersActive = hasActiveFilters(activeFilters);

  return (
    <main className="history-page">
      <header className="history-header">
        <Link className="brand" href="/">
          DamdAImin
        </Link>
        <div className="history-account">
          <span>{accountEmail || 'Private account'}</span>
          <button className="text-button" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <section className="history-content" aria-busy={loading} aria-labelledby="history-title">
        <div className="history-heading">
          <p className="eyebrow">Analysis History</p>
          <h1 id="history-title">Your Analysis History.</h1>
          <p>
            Return to queued, processing, failed, and completed Analyses. Search the unedited
            Transcript and narrow the list without exposing canceled records.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/analyze">
              New Analysis
            </Link>
          </div>
        </div>

        <form
          className="history-filters"
          aria-label="Filter Analysis History"
          onSubmit={applyFilters}
        >
          <div className="history-filter-grid">
            <label className="field history-filter-search">
              Search Transcript
              <input
                type="search"
                value={draftFilters.search}
                maxLength={200}
                placeholder="Words from a completed Transcript"
                aria-describedby="history-search-help"
                onChange={(event) => updateFilter('search', event.target.value)}
              />
            </label>
            <label className="field">
              Lifecycle state
              <select
                value={draftFilters.status}
                onChange={(event) =>
                  updateFilter('status', event.target.value as HistoryFilterState['status'])
                }
              >
                <option value="">Any state</option>
                <option value="queued">Queued</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label className="field">
              Result
              <select
                value={draftFilters.result}
                onChange={(event) =>
                  updateFilter('result', event.target.value as HistoryFilterState['result'])
                }
              >
                <option value="">Any result</option>
                <option value="definitive">Definitive classification</option>
                <option value="inconclusive">Inconclusive Result</option>
                <option value="happiness">Happiness</option>
                <option value="sadness">Sadness</option>
                <option value="anger">Anger</option>
                <option value="neutrality">Neutrality</option>
              </select>
            </label>
            <label className="field">
              Analysis Language
              <select
                value={draftFilters.language}
                onChange={(event) =>
                  updateFilter('language', event.target.value as HistoryFilterState['language'])
                }
              >
                <option value="">Any language</option>
                <option value="taglish">Taglish</option>
                <option value="english">English</option>
                <option value="tagalog">Tagalog</option>
              </select>
            </label>
            <label className="field">
              From date
              <input
                type="date"
                value={draftFilters.from}
                onChange={(event) => updateFilter('from', event.target.value)}
              />
            </label>
            <label className="field">
              To date
              <input
                type="date"
                value={draftFilters.to}
                onChange={(event) => updateFilter('to', event.target.value)}
              />
            </label>
          </div>
          <p id="history-search-help" className="field-hint">
            Transcript search applies to completed Analyses. Dates use the UTC calendar day.
          </p>
          <div className="history-filter-actions">
            <button className="primary-button" type="submit">
              Apply filters
            </button>
            <button className="secondary-button" type="button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        </form>

        {loading ? (
          <p className="loading-state" role="status" aria-live="polite">
            Checking your history…
          </p>
        ) : null}
        {error ? (
          <div className="history-error">
            <p className="form-message" role="alert">
              {error}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setReloadToken((current) => current + 1)}
            >
              Try again
            </button>
          </div>
        ) : null}
        {!loading && !error && analyses.length === 0 && !filtersActive ? (
          <div className="empty-history" role="status">
            <div className="empty-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="card-kicker">No analyses yet</p>
            <h2>Your first reading will live here.</h2>
            <p>
              When you submit one utterance for Analysis, its persisted progress and result will
              stay attached to this account.
            </p>
          </div>
        ) : null}
        {!loading && !error && analyses.length === 0 && filtersActive ? (
          <div className="empty-history filtered-empty" role="status">
            <p className="card-kicker">No matching Analyses</p>
            <h2>Try a wider search.</h2>
            <p>No Analysis matches every selected filter. Clear one or more filters to continue.</p>
            <button className="secondary-button" type="button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}
        {!loading && !error && analyses.length > 0 ? (
          <>
            {hasMore ? (
              <p className="history-bounded-note" role="status">
                Showing the newest 50 Analyses. Add filters to narrow older records.
              </p>
            ) : null}
            <ul className="history-list">
              {analyses.map((analysis) => (
                <li key={analysis.id}>
                  <Link className="history-item-link" href={`/analyses/${analysis.id}`}>
                    <span className="history-item-main">
                      <span className="history-item-status">{formatStatus(analysis.status)}</span>
                      <strong>{formatResult(analysis)}</strong>
                      {analysis.result?.transcript ? (
                        <span className="history-transcript">“{analysis.result.transcript}”</span>
                      ) : null}
                    </span>
                    <span className="history-item-meta">
                      <span>{formatLanguage(analysis.language)}</span>
                      <time dateTime={analysis.createdAt}>
                        {new Date(analysis.createdAt).toLocaleString()}
                      </time>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </main>
  );
}

function buildHistoryUrl(filters: HistoryFilterState): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.result) params.set('result', filters.result);
  if (filters.language) params.set('language', filters.language);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);

  const query = params.toString();
  return `${apiBaseUrl}/analyses${query ? `?${query}` : ''}`;
}

function hasActiveFilters(filters: HistoryFilterState): boolean {
  return Boolean(
    filters.search ||
    filters.status ||
    filters.result ||
    filters.language ||
    filters.from ||
    filters.to,
  );
}

function formatStatus(status: AnalysisHistoryItem['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatLanguage(language: AnalysisHistoryItem['language']): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}

function formatResult(analysis: AnalysisHistoryItem): string {
  if (!analysis.result) {
    return analysis.status === 'failed' ? 'Analysis failed' : 'Awaiting result';
  }

  if (analysis.result.outcome === 'inconclusive') {
    return 'Inconclusive Result';
  }

  return `${formatLabel(analysis.result.emotionClassification)} classification`;
}

function formatLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
