'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  FileAudio,
  History,
  LayoutDashboard,
  LogOut,
  Mic2,
  Play,
  Plus,
  Search,
} from 'lucide-react';

import type {
  AnalysisHistoryItem,
  AnalysisHistoryQuery,
  AnalysisHistoryResponse,
} from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';
import { formatClassification } from '../lib/analysis-result';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v2').replace(
  /\/$/,
  '',
);

type HistoryEmotionFilter = Exclude<
  NonNullable<AnalysisHistoryQuery['result']>,
  'definitive' | 'inconclusive'
>;

interface HistoryFilterState {
  search: string;
  result: HistoryEmotionFilter | '';
  from: string;
  to: string;
}

const emptyFilters: HistoryFilterState = {
  search: '',
  result: '',
  from: '',
  to: '',
};

const HISTORY_PAGE_SIZE = 10;

export function HistoryClient() {
  const router = useRouter();
  const [analyses, setAnalyses] = useState<AnalysisHistoryItem[]>([]);
  const [accountEmail, setAccountEmail] = useState('');
  const [draftFilters, setDraftFilters] = useState<HistoryFilterState>(emptyFilters);
  const [activeFilters, setActiveFilters] = useState<HistoryFilterState>(emptyFilters);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
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
      setPage(1);

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
    setPage(1);
    setActiveFilters({ ...draftFilters, search: draftFilters.search.trim() });
  }

  function clearFilters() {
    setPage(1);
    setDraftFilters(emptyFilters);
    setActiveFilters(emptyFilters);
  }

  async function signOut() {
    await authClient.signOut();
    router.replace('/auth/sign-in');
  }

  const filtersActive = hasActiveFilters(activeFilters);
  const accountLabel = formatAccountName(accountEmail);
  const pageCount = Math.max(1, Math.ceil(analyses.length / HISTORY_PAGE_SIZE));
  const pageStart = (page - 1) * HISTORY_PAGE_SIZE;
  const visibleAnalyses = analyses.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);

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
              <LayoutDashboard className="dashboard-nav-icon" aria-hidden="true" />
              Dashboard
            </Link>
            <Link className="dashboard-nav-item" href="/analyze">
              <Mic2 className="dashboard-nav-icon" aria-hidden="true" />
              New Analysis
            </Link>
            <a className="dashboard-nav-item" href="#recent-analyses">
              <History className="dashboard-nav-icon" aria-hidden="true" />
              Analysis History
            </a>
          </div>
          <div className="dashboard-nav-group dashboard-nav-tools">
            <p>Workspace</p>
            <button className="dashboard-nav-item" type="button" onClick={signOut}>
              <LogOut className="dashboard-nav-icon" aria-hidden="true" />
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
          <div className="dashboard-toolbar-spacer" aria-hidden="true" />
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

              <div className="dashboard-welcome-copy">
                <h2 id="welcome-card-title">What’s on your mind?</h2>

                <p>Share a short recording and see what your voice and words reveal.</p>
              </div>

              <Link
                href="/analyze"
                className="dashboard-microphone-button"
                aria-label="Start recording"
              >
                <span className="dashboard-microphone" aria-hidden="true">
                  <Mic2 size={42} strokeWidth={1.7} />
                </span>

                <span className="dashboard-microphone-label">
                  <strong>Tap to record</strong>
                  <small>Up to 20 seconds</small>
                </span>
              </Link>
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
                  <Plus size={18} strokeWidth={2} />
                </span>
                New Analysis
              </Link>
              <a className="dashboard-quick-action" href="#recent-analyses">
                <span className="dashboard-quick-icon dashboard-quick-icon-file" aria-hidden="true">
                  <FileAudio size={18} strokeWidth={1.8} />
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
            <form
              className="dashboard-search"
              role="search"
              aria-label="Search your analyses"
              onSubmit={applyFilters}
            >
              <label className="dashboard-search-field" htmlFor="recent-search-input">
                <span className="dashboard-search-icon" aria-hidden="true">
                  <Search size={19} strokeWidth={2} />
                </span>
                <span className="sr-only">Search your analyses</span>
                <input
                  id="recent-search-input"
                  type="search"
                  value={draftFilters.search}
                  maxLength={200}
                  placeholder="Search your analyses..."
                  aria-describedby="history-search-help"
                  onChange={(event) => updateFilter('search', event.target.value)}
                />
              </label>
              <button className="dashboard-search-submit" type="submit" aria-label="Search">
                <ArrowUpRight size={18} aria-hidden="true" />
              </button>
            </form>

            <div className="dashboard-recordings-heading">
              <div className="dashboard-recordings-title">
                <span className="dashboard-recordings-icon" aria-hidden="true">
                  <Activity size={22} strokeWidth={1.8} />
                </span>
                <div>
                  <h2 id="recent-title">Recent Analyses</h2>
                  <p>Your recent speech emotion records</p>
                </div>
              </div>
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
                    Emotion or date <ChevronDown size={15} aria-hidden="true" />
                  </span>
                </summary>
                <div className="dashboard-filter-grid">
                  <label className="field">
                    <span>Emotion</span>
                    <select
                      value={draftFilters.result}
                      onChange={(event) =>
                        updateFilter('result', event.target.value as HistoryFilterState['result'])
                      }
                    >
                      <option value="">Any emotion</option>
                      <option value="happiness">Happy</option>
                      <option value="sadness">Sad</option>
                      <option value="anger">Angry</option>
                      <option value="neutrality">Neutral</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>From date</span>
                    <input
                      type="date"
                      value={draftFilters.from}
                      max={draftFilters.to || undefined}
                      onChange={(event) => updateFilter('from', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>To date</span>
                    <input
                      type="date"
                      value={draftFilters.to}
                      min={draftFilters.from || undefined}
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

            {loading ? <HistoryTableSkeleton /> : null}
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
                <p>Record your first speech to see your results here.</p>
                <Link className="primary-button" href="/analyze">
                  Start recording
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
                {visibleAnalyses.map((analysis) => (
                  <Link
                    className="dashboard-table-row dashboard-table-record"
                    href={`/analyses/${analysis.id}`}
                    key={analysis.id}
                    role="row"
                    aria-label={`Open ${formatEmotionLabel(analysis)} analysis ${analysis.id} from ${formatDashboardDate(analysis.createdAt)}`}
                  >
                    <span className="dashboard-record-cell" role="cell">
                      <span className="dashboard-play-icon" aria-hidden="true">
                        <Play size={12} fill="currentColor" />
                      </span>
                      <span>
                        <strong title={analysis.id}>#{analysis.id.slice(0, 8)}</strong>
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
                      <ArrowUpRight size={17} />
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
            {!loading && !error && analyses.length > 0 ? (
              <nav className="dashboard-pagination" aria-label="Analysis list pagination">
                <p role="status" aria-live="polite">
                  Page {page} of {pageCount} · Showing {pageStart + 1}–
                  {pageStart + visibleAnalyses.length} of {analyses.length}
                </p>
                <div className="dashboard-pagination-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={page === pageCount}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </nav>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}

function HistoryTableSkeleton() {
  return (
    <div
      className="dashboard-history-skeleton"
      role="status"
      aria-label="Loading recent analyses"
      aria-live="polite"
    >
      <span className="sr-only">Loading recent analyses</span>
      <div className="dashboard-table dashboard-history-skeleton-table" aria-hidden="true">
        <div className="dashboard-table-row dashboard-table-header">
          <span>Record</span>
          <span>Transcript</span>
          <span>Emotion</span>
          <span>Language</span>
          <span>Date</span>
          <span />
        </div>
        {Array.from({ length: 5 }, (_, index) => (
          <div className="dashboard-table-row dashboard-history-skeleton-row" key={index}>
            <span className="dashboard-history-skeleton-record">
              <i />
              <span>
                <i />
                <i />
              </span>
            </span>
            <i className="dashboard-history-skeleton-line dashboard-history-skeleton-transcript" />
            <i className="dashboard-history-skeleton-line dashboard-history-skeleton-emotion" />
            <i className="dashboard-history-skeleton-line dashboard-history-skeleton-language" />
            <i className="dashboard-history-skeleton-line dashboard-history-skeleton-date" />
            <i className="dashboard-history-skeleton-arrow" />
          </div>
        ))}
      </div>
    </div>
  );
}

function buildHistoryUrl(filters: HistoryFilterState): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.result) params.set('result', filters.result);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);

  const query = params.toString();
  return `${apiBaseUrl}/analyses${query ? `?${query}` : ''}`;
}

function hasActiveFilters(filters: HistoryFilterState): boolean {
  return Boolean(filters.search || filters.result || filters.from || filters.to);
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
    timeZone: 'UTC',
  });
}

function truncateTranscript(value: string): string {
  return value.length > 62 ? `${value.slice(0, 62).trimEnd()}…` : value;
}

function formatEmotionLabel(analysis: AnalysisHistoryItem): string {
  if (analysis.result?.outcome === 'definitive') {
    return formatClassification(analysis.result.emotionClassification);
  }

  if (analysis.result?.outcome === 'inconclusive') return 'Inconclusive';
  return formatStatus(analysis.status);
}

function getEmotionKey(analysis: AnalysisHistoryItem): string {
  return analysis.result?.outcome === 'definitive'
    ? analysis.result.emotionClassification
    : 'pending';
}
