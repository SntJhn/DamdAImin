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
  const accountLabel = formatAccountName(accountEmail);

  return (
    <main className="dashboard-page">
      <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
        <Link className="dashboard-brand" href="/" aria-label="DamdAImin home">
          <span>
            Damd<span className="dashboard-brand-accent">AI</span>min
          </span>
          <img src="/landing/brand-mark.svg" alt="" aria-hidden="true" />
        </Link>

        <div className="dashboard-profile">
          <span className="dashboard-avatar" aria-hidden="true">
            {accountLabel.charAt(0).toUpperCase()}
          </span>
          <span className="dashboard-profile-copy">
            <strong>{accountLabel}</strong>
            <span>Private workspace</span>
          </span>
        </div>

        <nav className="dashboard-nav">
          <div className="dashboard-nav-group">
            <p>General</p>
            <Link className="dashboard-nav-item dashboard-nav-item-active" href="/history">
              <span className="dashboard-nav-icon dashboard-nav-icon-grid" aria-hidden="true" />
              Dashboard
            </Link>
            <Link className="dashboard-nav-item" href="/analyze">
              <span className="dashboard-nav-icon dashboard-nav-icon-mic" aria-hidden="true" />
              New Analysis
            </Link>
            <a className="dashboard-nav-item" href="#recent-analyses">
              <span className="dashboard-nav-icon dashboard-nav-icon-bars" aria-hidden="true" />
              Analysis History
            </a>
          </div>
          <div className="dashboard-nav-group dashboard-nav-tools">
            <p>Workspace</p>
            <button className="dashboard-nav-item" type="button" onClick={signOut}>
              <span className="dashboard-nav-icon dashboard-nav-icon-exit" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </nav>

        <p className="dashboard-sidebar-footer">
          <span>TSERA</span>
          <span>Speech emotion lab</span>
        </p>
      </aside>

      <section className="dashboard-main" aria-busy={loading} aria-labelledby="history-title">
        <header className="dashboard-toolbar">
          <form className="dashboard-search" onSubmit={applyFilters}>
            <label className="dashboard-search-field" htmlFor="dashboard-search-input">
              <span className="dashboard-search-icon" aria-hidden="true">
                ⌕
              </span>
              <span className="sr-only">Search transcripts</span>
              <input
                id="dashboard-search-input"
                type="search"
                value={draftFilters.search}
                maxLength={200}
                placeholder="Search recordings, transcripts, emotions…"
                aria-describedby="history-search-help"
                onChange={(event) => updateFilter('search', event.target.value)}
              />
            </label>
            <button className="dashboard-search-submit" type="submit" aria-label="Apply search">
              ↗
            </button>
          </form>
          <span className="dashboard-toolbar-account">{accountEmail || 'Private account'}</span>
        </header>

        <div className="dashboard-content">
          <div className="dashboard-heading">
            <p className="eyebrow">Dashboard</p>
            <h1 id="history-title">
              Welcome back, <span>{accountLabel}</span>
            </h1>
          </div>

          <div className="dashboard-overview">
            <section className="dashboard-welcome-card" aria-labelledby="welcome-card-title">
              <span
                className="dashboard-card-corner dashboard-card-corner-top"
                aria-hidden="true"
              />
              <span
                className="dashboard-card-corner dashboard-card-corner-bottom"
                aria-hidden="true"
              />
              <div>
                <p className="dashboard-card-kicker">YOUR NEXT SIGNAL</p>
                <h2 id="welcome-card-title">What’s up?</h2>
                <p>
                  How are you feeling today?
                  <br />
                  Take a moment to express yourself.
                </p>
                <Link className="dashboard-card-link" href="/analyze">
                  Start with your voice <span aria-hidden="true">↗</span>
                </Link>
              </div>
              <span className="dashboard-microphone" aria-hidden="true">
                <span className="dashboard-microphone-dot" />
                <span className="dashboard-microphone-ring" />
              </span>
            </section>

            <section className="dashboard-tools-card" aria-labelledby="quick-actions-title">
              <p className="dashboard-card-kicker" id="quick-actions-title">
                QUICK ACTIONS
              </p>
              <Link
                className="dashboard-quick-action dashboard-quick-action-primary"
                href="/analyze"
              >
                <span className="dashboard-quick-icon" aria-hidden="true">
                  +
                </span>
                New Analysis
              </Link>
              <a className="dashboard-quick-action" href="#recent-analyses">
                <span className="dashboard-quick-icon dashboard-quick-icon-file" aria-hidden="true">
                  ▤
                </span>
                Analysis History
              </a>
            </section>
          </div>

          <section
            className="dashboard-recordings"
            id="recent-analyses"
            aria-labelledby="recent-title"
          >
            <div className="dashboard-recordings-heading">
              <div className="dashboard-recordings-title">
                <span className="dashboard-recordings-icon" aria-hidden="true">
                  ◒
                </span>
                <div>
                  <h2 id="recent-title">Recent Analyses</h2>
                  <p>Your recent speech emotion records</p>
                </div>
              </div>
              <span className="dashboard-recordings-arrow" aria-hidden="true">
                ↗
              </span>
            </div>

            <form
              className="dashboard-filter-form"
              aria-label="Filter Analysis History"
              onSubmit={applyFilters}
            >
              <details className="dashboard-filter-drawer" open={filtersActive}>
                <summary>
                  <span>Filter history</span>
                  <span>
                    State, result, language, or date <b aria-hidden="true">⌄</b>
                  </span>
                </summary>
                <div className="dashboard-filter-grid">
                  <label className="field">
                    <span>Lifecycle state</span>
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
                    <span>Result</span>
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
                    <span>Analysis language</span>
                    <select
                      value={draftFilters.language}
                      onChange={(event) =>
                        updateFilter(
                          'language',
                          event.target.value as HistoryFilterState['language'],
                        )
                      }
                    >
                      <option value="">Any language</option>
                      <option value="taglish">Taglish</option>
                      <option value="english">English</option>
                      <option value="tagalog">Tagalog</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>From date</span>
                    <input
                      type="date"
                      value={draftFilters.from}
                      onChange={(event) => updateFilter('from', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>To date</span>
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
                <div className="dashboard-filter-actions">
                  <button className="primary-button" type="submit">
                    Apply filters
                  </button>
                  <button className="secondary-button" type="button" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              </details>
            </form>

            {hasMore ? (
              <p className="dashboard-bounded-note" role="status">
                Showing the newest 50 Analyses. Add filters to narrow older records.
              </p>
            ) : null}

            {loading ? (
              <p className="dashboard-state" role="status" aria-live="polite">
                Checking your history…
              </p>
            ) : null}
            {error ? (
              <div className="dashboard-state dashboard-error" role="alert">
                <p className="form-message">{error}</p>
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
              <div className="empty-history dashboard-empty-history" role="status">
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
                <Link className="primary-button" href="/analyze">
                  Start a new analysis
                </Link>
              </div>
            ) : null}
            {!loading && !error && analyses.length === 0 && filtersActive ? (
              <div className="empty-history dashboard-empty-history filtered-empty" role="status">
                <p className="card-kicker">No matching Analyses</p>
                <h2>Try a wider search.</h2>
                <p>
                  No Analysis matches every selected filter. Clear one or more filters to continue.
                </p>
                <button className="secondary-button" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            ) : null}
            {!loading && !error && analyses.length > 0 ? (
              <div className="dashboard-table" role="table" aria-label="Recent analyses">
                <div className="dashboard-table-row dashboard-table-header" role="row">
                  <span role="columnheader">Record</span>
                  <span role="columnheader">Transcript</span>
                  <span role="columnheader">Emotion</span>
                  <span role="columnheader">Language</span>
                  <span role="columnheader">Date</span>
                  <span role="columnheader" aria-label="Open record" />
                </div>
                {analyses.map((analysis) => (
                  <Link
                    className="dashboard-table-row dashboard-table-record"
                    href={`/analyses/${analysis.id}`}
                    key={analysis.id}
                    role="row"
                    aria-label={`Open analysis ${analysis.id}`}
                  >
                    <span className="dashboard-record-cell" role="cell">
                      <span className="dashboard-play-icon" aria-hidden="true">
                        ▶
                      </span>
                      <span>
                        <strong>Analysis record</strong>
                        <small>#{analysis.id.slice(0, 8)}</small>
                      </span>
                    </span>
                    <span className="dashboard-transcript-cell" role="cell">
                      {analysis.result?.transcript
                        ? `“${truncateTranscript(analysis.result.transcript)}”`
                        : 'Awaiting transcript'}
                    </span>
                    <span
                      className={`dashboard-emotion dashboard-emotion-${getEmotionKey(analysis)}`}
                      role="cell"
                    >
                      <i aria-hidden="true" />
                      {formatEmotionLabel(analysis)}
                    </span>
                    <span className="dashboard-language-cell" role="cell">
                      {formatLanguage(analysis.language)}
                    </span>
                    <time className="dashboard-date-cell" dateTime={analysis.createdAt} role="cell">
                      {formatDashboardDate(analysis.createdAt)}
                    </time>
                    <span className="dashboard-row-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        </div>
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

function formatAccountName(email: string): string {
  if (!email) return 'your workspace';

  const localPart = email
    .split('@')[0]
    ?.replace(/[._-]+/g, ' ')
    .trim();
  if (!localPart) return 'your workspace';

  return localPart.replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDashboardDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function truncateTranscript(value: string): string {
  return value.length > 62 ? `${value.slice(0, 62).trimEnd()}…` : value;
}

function formatEmotionLabel(analysis: AnalysisHistoryItem): string {
  if (analysis.result?.outcome === 'definitive') {
    return formatLabel(analysis.result.emotionClassification);
  }

  if (analysis.result?.outcome === 'inconclusive') return 'Inconclusive';
  return formatStatus(analysis.status);
}

function getEmotionKey(analysis: AnalysisHistoryItem): string {
  return analysis.result?.outcome === 'definitive'
    ? analysis.result.emotionClassification
    : 'pending';
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
