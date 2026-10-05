'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  BarChart3,
  CircleCheck,
  FileText,
  History,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  LogOut,
  Mic2,
} from 'lucide-react';

import type { AnalysisResource, AnalysisResult, EmotionClassification } from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';
import {
  describeLayerScores,
  describeScoreAdjustment,
  formatClassification,
  formatProbability,
  formatProbabilityDistribution,
  formatScoreDelta,
  getAnalysisLanguagePresentation,
  getAnalysisOutcomePresentation,
  getLeadingClassifications,
} from '../lib/analysis-result';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v2').replace(
  /\/$/,
  '',
);

const classificationKeys = ['happiness', 'sadness', 'anger', 'neutrality'] as const;
const emotionArtwork: Record<EmotionClassification, string> = {
  happiness: 'happy.svg',
  sadness: 'sad.svg',
  anger: 'angry.svg',
  neutrality: 'neutral.svg',
};

type EmotionScores = Record<EmotionClassification, number>;
type CueSpan = AnalysisResult['technicalTrace']['cueSpans'][number];

export function AnalysisDetailClient({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisResource | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let currentStatus: AnalysisResource['status'] | undefined;

    function clearPoll() {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
    }

    function isActive() {
      return currentStatus === 'queued' || currentStatus === 'processing';
    }

    function schedulePoll() {
      clearPoll();
      if (!cancelled && !document.hidden && isActive()) {
        timeout = setTimeout(() => {
          timeout = undefined;
          void loadAnalysis();
        }, 2_000);
      }
    }

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
          throw new Error(
            'We couldn’t find this result. It may have been deleted, so check your history.',
          );
        }
        if (!response.ok) {
          throw new Error(
            'We couldn’t load this result. Check your connection and refresh the page.',
          );
        }

        const body = (await response.json()) as AnalysisResource;
        if (cancelled) return;
        currentStatus = body.status;
        setAnalysis(body);
        setAccountEmail(user.email);
        schedulePoll();
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'We couldn’t load this result. Check your connection and refresh the page.',
          );
        }
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        clearPoll();
      } else if (isActive()) {
        void loadAnalysis();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void loadAnalysis();
    return () => {
      cancelled = true;
      clearPoll();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [analysisId, router]);

  async function signOut() {
    await authClient.signOut();
    router.replace('/auth/sign-in');
  }

  async function runLifecycleAction(action: 'cancel' | 'retry') {
    setError('');
    setActionBusy(true);

    try {
      const token = await getAuthToken();
      if (!token) {
        setActionBusy(false);
        router.replace(`/auth/sign-in?next=/analyses/${analysisId}`);
        return;
      }

      const response = await fetch(`${apiBaseUrl}/analyses/${analysisId}/${action}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (response.status === 401) {
        setActionBusy(false);
        router.replace(`/auth/sign-in?next=/analyses/${analysisId}`);
        return;
      }

      const body = (await response.json()) as
        | AnalysisResource
        | {
            analysis?: AnalysisResource;
            message?: string;
          };
      if (!response.ok) {
        throw new Error(
          'message' in body && typeof body.message === 'string'
            ? body.message
            : `We couldn’t ${action} this analysis. Try again.`,
        );
      }

      if (action === 'retry') {
        const retried = 'analysis' in body ? body.analysis : undefined;
        if (!retried?.id) throw new Error('We couldn’t start a new attempt. Try again.');
        router.replace(`/analyses/${retried.id}`);
        return;
      }

      setAnalysis(body as AnalysisResource);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : `We couldn’t ${action} this analysis. Try again.`,
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteAnalysis() {
    if (!window.confirm('Delete this result and its recording? This can’t be undone.')) return;

    setError('');
    setActionBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setActionBusy(false);
        router.replace(`/auth/sign-in?next=/analyses/${analysisId}`);
        return;
      }

      const response = await fetch(`${apiBaseUrl}/analyses/${analysisId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (response.status === 401) {
        setActionBusy(false);
        router.replace(`/auth/sign-in?next=/analyses/${analysisId}`);
        return;
      }
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'We couldn’t find this result. It may already be deleted.'
            : 'We couldn’t delete this analysis. Try again.',
        );
      }

      router.replace('/history');
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'We couldn’t delete this analysis. Try again.',
      );
      setActionBusy(false);
    }
  }

  const accountLabel = formatAnalysisAccountName(accountEmail);

  return (
    <main className="dashboard-page analysis-result-page">
      <aside className="dashboard-sidebar" aria-label="Analysis navigation">
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
            <Link className="dashboard-nav-item" href="/history">
              <LayoutDashboard className="dashboard-nav-icon" aria-hidden="true" />
              Dashboard
            </Link>
            <Link className="dashboard-nav-item" href="/analyze">
              <Mic2 className="dashboard-nav-icon" aria-hidden="true" />
              New Analysis
            </Link>
            <Link
              className="dashboard-nav-item dashboard-nav-item-active"
              href="/history#recent-analyses"
            >
              <History className="dashboard-nav-icon" aria-hidden="true" />
              Analysis History
            </Link>
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

      <section
        className="dashboard-main"
        aria-busy={!analysis && !error}
        aria-labelledby="analysis-result-title"
      >
        <header className="dashboard-toolbar">
          <Link
            className="dashboard-search analysis-search-link"
            href="/history"
            aria-label="Return to analysis history"
          >
            <span className="dashboard-search-field">
              <span className="dashboard-search-icon" aria-hidden="true">
                <ArrowLeft size={18} />
              </span>
              <span>Back to Analysis History</span>
            </span>
            <span className="dashboard-search-submit" aria-hidden="true">
              <ArrowUpRight size={18} />
            </span>
          </Link>
          <span className="dashboard-toolbar-account">{accountEmail || 'Private account'}</span>
        </header>

        <div className="analysis-result-content">
          <div className="analysis-result-heading">
            <Link className="analysis-result-breadcrumb" href="/history">
              <History size={14} aria-hidden="true" />
              Analysis History <span aria-hidden="true">/</span> Result
            </Link>
            <h1 id="analysis-result-title">Analysis Result</h1>
            <p>Here’s what your voice and words showed, and why.</p>
          </div>
          {error ? (
            <p className="form-message analysis-result-error" role="alert">
              {error}
            </p>
          ) : null}

          {analysis ? (
            <div aria-live="polite">
              {analysis.status === 'completed' && analysis.result ? (
                <AnalysisRecord
                  result={analysis.result}
                  language={analysis.language}
                  createdAt={analysis.createdAt}
                />
              ) : (
                <AnalysisLifecycleState
                  analysis={analysis}
                  actionBusy={actionBusy}
                  onCancel={() => void runLifecycleAction('cancel')}
                  onRetry={() => void runLifecycleAction('retry')}
                  onDelete={() => void deleteAnalysis()}
                />
              )}
            </div>
          ) : !error ? (
            <AnalysisResultSkeleton />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function AnalysisResultSkeleton() {
  return (
    <div
      className="analysis-result-skeleton"
      role="status"
      aria-label="Loading analysis result"
      aria-live="polite"
    >
      <span className="sr-only">Loading analysis result</span>
      <div aria-hidden="true">
        <div className="analysis-result-skeleton-hero">
          <i />
          <i />
          <i />
          <span>
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="analysis-result-skeleton-panel">
          <i />
          <i />
          <i />
        </div>
        <div className="analysis-result-skeleton-panel analysis-result-skeleton-breakdown">
          <i />
          <span>
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </div>
  );
}

function AnalysisLifecycleState({
  analysis,
  actionBusy,
  onCancel,
  onRetry,
  onDelete,
}: {
  analysis: AnalysisResource;
  actionBusy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const isActive = analysis.status === 'queued' || analysis.status === 'processing';

  if (isActive) {
    const isProcessing = analysis.status === 'processing';
    const title = isProcessing
      ? 'DamdAImin is reading your signal.'
      : 'Your signal is safely in line.';
    const message = isProcessing
      ? 'We’re turning your recording into text and analyzing it. This can take a few minutes.'
      : 'Your recording is saved and waiting for its turn. Analysis will start shortly.';

    return (
      <section
        className={`analysis-result-state-card analysis-result-state-card--active analysis-result-state-card--${analysis.status}`}
        aria-labelledby="analysis-stage-title"
      >
        <div className="analysis-waiting-header">
          <div className="analysis-waiting-heading">
            <p className="dashboard-card-kicker">Live analysis</p>
            <h2 id="analysis-stage-title">{title}</h2>
            <p>{message}</p>
          </div>
          <span className="analysis-waiting-status">
            <span aria-hidden="true" />
            {isProcessing ? 'Processing' : 'Queued'}
          </span>
        </div>

        <div
          className="analysis-signal-progress"
          role="progressbar"
          aria-label={`Analysis ${analysis.status}`}
        >
          <svg
            className="analysis-signal-wave"
            viewBox="0 0 800 96"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path className="analysis-signal-baseline" d="M0 48H800" />
            <path
              className="analysis-signal-wave-echo"
              d="M0 48h72l12-8 12 16 14-28 14 40 14-54 14 68 14-45 14 26 14-14 14 8 14-22 14 26 14-42 14 58 14-30 14 16 14-8 14 4h88l14-10 14 22 14-38 14 50 14-64 14 74 14-48 14 30 14-14 14 6h188"
            />
            <path
              className="analysis-signal-wave-line"
              d="M0 48h72l12-8 12 16 14-28 14 40 14-54 14 68 14-45 14 26 14-14 14 8 14-22 14 26 14-42 14 58 14-30 14 16 14-8 14 4h88l14-10 14 22 14-38 14 50 14-64 14 74 14-48 14 30 14-14 14 6h188"
            />
          </svg>
          <span className="analysis-signal-sweep" aria-hidden="true" />
        </div>

        <ol className="analysis-stage-rail" aria-label="Analysis progress">
          <li className="analysis-stage-step analysis-stage-step--complete">
            <span className="analysis-stage-marker" aria-hidden="true">
              ✓
            </span>
            <span>
              <strong>Recording received</strong>
              <small>Saved privately</small>
            </span>
          </li>
          <li className="analysis-stage-step analysis-stage-step--current" aria-current="step">
            <span className="analysis-stage-marker" aria-hidden="true">
              2
            </span>
            <span>
              <strong>Analyzing your speech</strong>
              <small>{isProcessing ? 'In progress now' : 'Waiting to start'}</small>
            </span>
          </li>
          <li className="analysis-stage-step analysis-stage-step--upcoming">
            <span className="analysis-stage-marker" aria-hidden="true">
              3
            </span>
            <span>
              <strong>Result ready</strong>
              <small>Appears here automatically</small>
            </span>
          </li>
        </ol>

        <div className="analysis-waiting-footer">
          <div className="analysis-waiting-assurance">
            <strong>You don’t need to do anything.</strong>
            <span>
              You can leave this page. Your result will be in your history when it’s ready.
            </span>
          </div>
          <div className="analysis-waiting-actions">
            <button
              className="analysis-result-button analysis-result-button-secondary"
              type="button"
              disabled={actionBusy}
              aria-describedby="analysis-cancel-description"
              onClick={onCancel}
            >
              {actionBusy ? 'Canceling…' : 'Cancel Analysis'}
            </button>
            <button
              className="analysis-result-button analysis-result-button-quiet"
              type="button"
              disabled={actionBusy}
              aria-describedby="analysis-delete-description"
              onClick={onDelete}
            >
              {actionBusy ? 'Deleting…' : 'Delete Analysis'}
            </button>
          </div>
          <p id="analysis-cancel-description" className="analysis-visually-hidden">
            Canceling removes your recording and anything created from it.
          </p>
          <p id="analysis-delete-description" className="analysis-visually-hidden">
            Deletes this result and your recording.
          </p>
          <p className="analysis-result-id">Analysis ID: {analysis.id}</p>
        </div>
      </section>
    );
  }

  const isFailed = analysis.status === 'failed';
  const isCanceled = analysis.status === 'canceled';

  const title = isFailed
    ? 'We couldn’t analyze this recording'
    : isCanceled
      ? 'Analysis canceled'
      : 'This result is incomplete';

  const message = isFailed
    ? (analysis.failureMessage ??
      'We couldn’t analyze this recording. Check that the audio is clear and try again.')
    : isCanceled
      ? 'This Analysis was canceled.'
      : 'We couldn’t load the full result. Record again to get a new one.';

  return (
    <section className="analysis-result-state-card" aria-labelledby="analysis-stage-title">
      <div className="analysis-result-state-icon" aria-hidden="true">
        {isFailed ? '!' : isCanceled ? '×' : '…'}
      </div>
      <div className="analysis-result-state-copy">
        <p className="dashboard-card-kicker">Status</p>
        <h2 id="analysis-stage-title">{title}</h2>
        <p>{message}</p>
      </div>

      <div className="analysis-result-actions">
        {isFailed && analysis.retryAvailable ? (
          <button
            className="analysis-result-button analysis-result-button-primary"
            type="button"
            disabled={actionBusy}
            onClick={onRetry}
          >
            {actionBusy ? 'Preparing retry…' : 'Retry Analysis'}
          </button>
        ) : (
          <Link className="analysis-result-button analysis-result-button-primary" href="/analyze">
            Start recording
          </Link>
        )}
        <button
          className="analysis-result-button analysis-result-button-secondary"
          type="button"
          disabled={actionBusy}
          onClick={onDelete}
        >
          {actionBusy ? 'Deleting…' : 'Delete Analysis'}
        </button>
        {isFailed && !analysis.retryAvailable ? (
          <p>You can’t retry because the recording wasn’t kept. Record again to get a result.</p>
        ) : (
          <p>Deleting removes this result and your recording.</p>
        )}
      </div>
      <p className="analysis-result-id">Analysis ID: {analysis.id}</p>
    </section>
  );
}

function AnalysisRecord({
  result,
  language,
  createdAt,
}: {
  result: AnalysisResult;
  language: AnalysisResource['language'];
  createdAt: string;
}) {
  const languagePresentation = getAnalysisLanguagePresentation(language);
  const outcomePresentation = getAnalysisOutcomePresentation(result.outcome);
  const classification = result.outcome === 'definitive' ? result.emotionClassification : undefined;
  const classificationProbability = classification ? result.confidence[classification] : undefined;
  const classificationLabel = classification ? formatClassification(classification) : undefined;

  return (
    <article className="analysis-record" aria-labelledby="analysis-outcome-title">
      <section
        className={`analysis-result-hero analysis-result-hero--${classification ?? 'inconclusive'}`}
        aria-label="Analysis outcome"
      >
        <div className="analysis-result-hero-copy">
          <p className="analysis-result-hero-kicker">
            {classification ? 'Detected emotion' : 'Result'}
          </p>
          <h2 id="analysis-outcome-title">{classificationLabel ?? outcomePresentation.label}</h2>
          <p>
            {classification
              ? 'This is the emotion that best matches your voice and words.'
              : outcomePresentation.description}
          </p>
          {classificationProbability !== undefined ? (
            <div className="analysis-result-hero-confidence">
              <div>
                <span>Confidence</span>
                <strong>{formatProbability(classificationProbability)}</strong>
              </div>
              <meter
                min="0"
                max="1"
                value={classificationProbability}
                aria-label={`${classificationLabel} confidence`}
              />
            </div>
          ) : null}
          <div className="analysis-result-hero-tags">
            <span>{languagePresentation.label}</span>
            <span title={languagePresentation.qualificationDescription}>
              {languagePresentation.qualification}
            </span>
            <span>{formatAnalysisDate(createdAt)}</span>
          </div>
        </div>
        <div className="analysis-result-hero-mark" aria-hidden="true">
          {classification ? (
            <img src={`/emotions/${emotionArtwork[classification]}`} alt="" />
          ) : (
            <span>?</span>
          )}
        </div>
      </section>

      <section className="analysis-result-panel" aria-labelledby="transcript-heading">
        <div className="analysis-result-panel-heading">
          <div>
            <p className="dashboard-card-kicker">
              <FileText size={14} aria-hidden="true" />
              Transcript
            </p>
            <h3 id="transcript-heading">What You Said</h3>
          </div>
        </div>
        <blockquote
          className={`analysis-transcript analysis-transcript-highlight${classification ? ` analysis-transcript-highlight--${classification}` : ''}`}
          aria-label="Transcript"
        >
          {result.transcript || (
            <span className="analysis-empty-value">No transcript was used for this analysis.</span>
          )}
        </blockquote>
      </section>

      {classification ? (
        <LayerComparison
          neural={result.technicalTrace.probabilities.before}
          symbolic={result.technicalTrace.probabilities.symbolic}
          combined={result.confidence}
        />
      ) : null}

      <WhyThisResult
        cueSpans={result.technicalTrace.cueSpans}
        classification={classification}
        neural={result.technicalTrace.probabilities.before}
        symbolic={result.technicalTrace.probabilities.symbolic}
        combined={result.confidence}
      />

      <section
        className={`analysis-result-trace analysis-result-trace--${classification ?? 'inconclusive'}`}
        aria-labelledby="traceability-heading"
      >
        <div className="analysis-result-section-heading">
          <div>
            <p className="dashboard-card-kicker">
              <Activity size={14} aria-hidden="true" />
              Evidence
            </p>
            <h2 id="traceability-heading">How DamdAImin reached this result</h2>
          </div>
        </div>

        <TechnicalTraceView
          trace={result.technicalTrace}
          classification={classification}
          explanation={result.explanation}
          versions={{
            contractVersion: result.contractVersion,
            schemaVersion: result.schemaVersion,
            modelVersion: result.modelVersion,
            preprocessingVersion: result.preprocessingVersion,
            ruleSetVersion: result.ruleSetVersion,
          }}
        />
      </section>
    </article>
  );
}

/* ---------- Layer comparison: Neural (audio), Symbolic (text), Combined ---------- */

function LayerComparison({
  neural,
  symbolic,
  combined,
}: {
  neural: EmotionScores;
  symbolic?: EmotionScores;
  combined: EmotionScores;
}) {
  // Every column uses the combined ranking so rows line up and the order is never hardcoded.
  const order = rankEmotions(combined).map((row) => row.classification);

  return (
    <section className="analysis-result-confidence" aria-labelledby="layers-heading">
      <div className="analysis-result-section-heading">
        <div>
          <p className="dashboard-card-kicker">
            <BarChart3 size={14} aria-hidden="true" />
            How each layer score
          </p>
          <h2 id="layers-heading">Score Breakdown</h2>
        </div>
      </div>
      <div className="analysis-result-confidence-grid analysis-result-confidence-grid--three">
        <LayerColumn
          title="Neural Layer"
          tag="Audio"
          description="Listens to how you sound."
          scores={neural}
          order={order}
        />
        <LayerColumn
          title="Symbolic Layer"
          tag="Rules"
          description="Checks voice and language clues against research rules."
          scores={symbolic}
          order={order}
        />
        <LayerColumn
          title="Combined Result"
          tag="Final"
          description="Both layers together."
          scores={combined}
          order={order}
          highlighted
        />
      </div>
    </section>
  );
}

function LayerColumn({
  title,
  tag,
  description,
  scores,
  order,
  highlighted = false,
}: {
  title: string;
  tag: string;
  description: string;
  scores?: EmotionScores;
  order: EmotionClassification[];
  highlighted?: boolean;
}) {
  const displayedProbabilities = scores
    ? formatProbabilityDistribution(order.map((classification) => scores[classification]))
    : [];

  return (
    <section
      className={`analysis-result-confidence-model${highlighted ? ` analysis-result-confidence-model--final analysis-result-confidence-model--${order[0]}` : ''}`}
      aria-label={title}
    >
      <div className="analysis-layer-heading">
        <h3>{title}</h3>
        <span className="analysis-layer-tag">{tag}</span>
      </div>
      <p className="analysis-layer-description">{description}</p>
      {scores ? (
        <ul className="analysis-result-confidence-list">
          {order.map((classification, index) => (
            <li
              className={`analysis-result-confidence-row analysis-result-confidence-row--${classification}`}
              key={classification}
            >
              <div className="analysis-result-confidence-label">
                <span>{formatClassification(classification)}</span>
                <strong>{displayedProbabilities[index]}</strong>
              </div>
              <meter
                min="0"
                max="1"
                value={scores[classification]}
                aria-label={`${title} ${formatClassification(classification)} probability`}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="analysis-result-confidence-unavailable">
          Scores for this layer weren’t recorded for this analysis.
        </p>
      )}
    </section>
  );
}

/* ---------- Why this result? ---------- */

function WhyThisResult({
  cueSpans,
  classification,
  neural,
  symbolic,
  combined,
}: {
  cueSpans: CueSpan[];
  classification?: EmotionClassification;
  neural: EmotionScores;
  symbolic?: EmotionScores;
  combined: EmotionScores;
}) {
  const voiceCues = cueSpans.filter((span) => span.source === 'acoustic');
  const transcriptCues = new Set(['asr_transcript', 'user_reviewed_transcript']);
  const wordCues = cueSpans
    .filter((span) => span.source === 'linguistic' && !transcriptCues.has(span.cue.toLowerCase()))
    .filter(
      (span, index, spans) =>
        spans.findIndex((candidate) => candidate.value === span.value) === index,
    );
  const audioLeaders = getLeadingClassifications(neural);
  const symbolicLeaders = symbolic ? getLeadingClassifications(symbolic) : [];

  let suggestion: string;
  if (!classification) {
    suggestion = 'The Research System marked this result inconclusive.';
  } else {
    suggestion = `The combined result leans ${formatClassification(classification)} (${formatProbability(combined[classification])}).`;
  }
  const scoreContext = classification
    ? [
        describeLayerScores('The audio model', neural),
        ...(symbolic ? [describeLayerScores('The symbolic layer', symbolic)] : []),
        'These scores are combined to produce the result for this recording.',
        ...(audioLeaders.length === 1 &&
        symbolicLeaders.length === 1 &&
        audioLeaders[0] !== symbolicLeaders[0]
          ? [
              'The layers leaned toward different emotions, so read the combined result with some care.',
            ]
          : []),
      ].join(' ')
    : undefined;

  return (
    <section
      className={`analysis-result-panel analysis-why${classification ? ` analysis-why--${classification}` : ''}`}
      aria-labelledby="why-heading"
    >
      <div className="analysis-result-panel-heading">
        <div>
          <p className="dashboard-card-kicker">
            <Lightbulb size={14} aria-hidden="true" />
            WHY THIS RESULT?
          </p>
          <h3 id="why-heading">Explanation Overview </h3>
        </div>
      </div>

      <div className="analysis-why-group">
        <h4>What this suggests</h4>
        <p className="analysis-why-summary">{suggestion}</p>
        {scoreContext ? <p className="analysis-why-summary">{scoreContext}</p> : null}
      </div>

      {voiceCues.length ? (
        <div className="analysis-why-group">
          <h4>Audio clues in this recording</h4>
          <ul className="analysis-why-list">
            {voiceCues.map((span, index) => (
              <li key={`${span.startMs}-${span.cue}-${index}`}>{describeVoiceCue(span)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {wordCues.length ? (
        <div className="analysis-why-group">
          <h4>Language clues in this recording</h4>
          <ul className="analysis-why-cue-list">
            {wordCues.map((span, index) => (
              <li key={`${span.cue}-${span.value}-${index}`}>
                <strong>{span.value}</strong>
                <span>{humanizeCue(span.cue)} cue</span>
              </li>
            ))}
          </ul>
          <p className="analysis-why-note">
            These are clues the system returned, not proof of how the speaker felt.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Evidence: overview, clue table, technical details ---------- */

function TechnicalTraceView({
  trace,
  classification,
  explanation,
  versions,
}: {
  trace: AnalysisResult['technicalTrace'];
  classification?: EmotionClassification;
  explanation: string;
  versions: Pick<
    AnalysisResult,
    'contractVersion' | 'schemaVersion' | 'modelVersion' | 'preprocessingVersion' | 'ruleSetVersion'
  >;
}) {
  const cueCount = trace.cueSpans.length;
  const ruleCount = trace.activatedRules.length;
  const audioScore = classification ? trace.probabilities.before[classification] : undefined;
  const finalScore = classification ? trace.probabilities.after[classification] : undefined;
  const resultCopy =
    audioScore === undefined || finalScore === undefined || classification === undefined
      ? 'The evidence did not favor one emotion clearly enough.'
      : `Audio layer: ${formatProbability(audioScore)}. Combined: ${formatProbability(finalScore)}.`;
  const beforeProbabilities = formatProbabilityDistribution(
    classificationKeys.map(
      (probabilityClassification) => trace.probabilities.before[probabilityClassification],
    ),
  );
  const afterProbabilities = formatProbabilityDistribution(
    classificationKeys.map(
      (probabilityClassification) => trace.probabilities.after[probabilityClassification],
    ),
  );

  return (
    <div className="analysis-trace-body">
      <ol className="analysis-trace-overview" aria-label="How the system reached the result">
        <li>
          <span className="analysis-trace-overview-step">
            <AudioLines size={15} aria-hidden="true" />
            Clues
          </span>
          <strong className="analysis-trace-overview-count">{cueCount}</strong>
          <div>
            <b>{cueCount === 1 ? 'clue found' : 'clues found'}</b>
            <p>
              {cueCount
                ? 'Words and sounds in your recording that shaped the result.'
                : 'No specific words or sounds were flagged.'}
            </p>
          </div>
        </li>
        <li>
          <span className="analysis-trace-overview-step">
            <ListChecks size={15} aria-hidden="true" />
            Rules
          </span>
          <strong className="analysis-trace-overview-count">{ruleCount}</strong>
          <div>
            <b>{ruleCount === 1 ? 'rule applied' : 'rules applied'}</b>
            <p>
              {ruleCount
                ? 'Research rules that adjusted the emotion scores.'
                : 'No research rules adjusted the scores.'}
            </p>
          </div>
        </li>
        <li
          className={`analysis-trace-overview-result${classification ? ` analysis-trace-overview-result--${classification}` : ''}`}
        >
          <span className="analysis-trace-overview-step">
            <CircleCheck size={15} aria-hidden="true" />
            Result
          </span>
          <strong>
            {classification ? formatClassification(classification) : 'No clear result'}
          </strong>
          <div>
            <b>
              {finalScore !== undefined
                ? `${formatProbability(finalScore)} final score`
                : 'Inconclusive'}
            </b>
            <p>{resultCopy}</p>
          </div>
        </li>
      </ol>

      <CueTable cueSpans={trace.cueSpans} />

      <details className="analysis-trace-technical">
        <summary>
          <span>
            <strong>SEE MORE</strong>
          </span>
          <span className="analysis-trace-technical-toggle" aria-hidden="true">
            +
          </span>
        </summary>

        <div className="analysis-trace-technical-body">
          <section className="analysis-trace-card" aria-labelledby="original-explanation-heading">
            <div className="analysis-trace-card-heading">
              <p className="dashboard-card-kicker">From the analysis system</p>
              <h3 id="original-explanation-heading">What the system reported</h3>
            </div>
            <details className="analysis-trace-raw-output">
              <summary>Show the original explanation</summary>
              <p>{explanation}</p>
            </details>
          </section>

          <div className="analysis-trace-columns analysis-trace-columns--two">
            <section className="analysis-trace-card" aria-labelledby="activated-rules-heading">
              <div className="analysis-trace-card-heading">
                <p className="dashboard-card-kicker">Text analysis</p>
                <h3 id="activated-rules-heading">Scoring rules used</h3>
              </div>
              {trace.activatedRules.length ? (
                <ul className="analysis-trace-list">
                  {trace.activatedRules.map((rule) => {
                    const description = describeResearchRule(rule.id, rule.description);
                    return (
                      <li key={rule.id}>
                        <strong>{description.title}</strong>
                        <p>{description.detail}</p>
                        <small>Rule ID: {rule.id}</small>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="analysis-empty-value">
                  No scoring rules changed the result for this recording.
                </p>
              )}
            </section>

            <section className="analysis-trace-card" aria-labelledby="score-adjustments-heading">
              <div className="analysis-trace-card-heading">
                <p className="dashboard-card-kicker">Score changes</p>
                <h3 id="score-adjustments-heading">How clues shifted the scores</h3>
              </div>
              {trace.scoreAdjustments.length ? (
                <ul className="analysis-trace-list">
                  {trace.scoreAdjustments.map((adjustment, index) => (
                    <li key={`${adjustment.emotionClassification}-${index}`}>
                      <div className="analysis-trace-item-heading">
                        <strong>{formatClassification(adjustment.emotionClassification)}</strong>
                        <span>{`${adjustment.delta >= 0 ? '+' : ''}${adjustment.delta.toFixed(2)} score`}</span>
                      </div>
                      <p>
                        {describeScoreAdjustment(
                          adjustment.reason,
                          adjustment.emotionClassification,
                          adjustment.delta,
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-empty-value">No clues changed the emotion scores.</p>
              )}
            </section>
          </div>

          <section
            className="analysis-trace-probabilities"
            aria-labelledby="probability-changes-heading"
          >
            <div className="analysis-trace-card-heading">
              <p className="dashboard-card-kicker">Emotion scores</p>
              <h3 id="probability-changes-heading">Scores before and after clue adjustments</h3>
            </div>
            <div
              className="probability-table-wrap"
              tabIndex={0}
              aria-label="Before-and-after probabilities table"
            >
              <table className="probability-table">
                <caption className="sr-only">
                  Emotion scores before and after clue adjustments
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Emotion</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {classificationKeys.map((probabilityClassification, index) => {
                    const before = trace.probabilities.before[probabilityClassification];
                    const after = trace.probabilities.after[probabilityClassification];
                    return (
                      <tr key={probabilityClassification}>
                        <th scope="row">{formatClassification(probabilityClassification)}</th>
                        <td>{beforeProbabilities[index]}</td>
                        <td>{afterProbabilities[index]}</td>
                        <td>{formatScoreDelta(after - before)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <details className="analysis-trace-versions">
            <summary>
              Model and system versions <span>Technical reference</span>
            </summary>
            <dl>
              <div>
                <dt>Contract</dt>
                <dd>{versions.contractVersion}</dd>
              </div>
              <div>
                <dt>Schema</dt>
                <dd>{versions.schemaVersion}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{versions.modelVersion}</dd>
              </div>
              <div>
                <dt>Preprocessing</dt>
                <dd>{versions.preprocessingVersion}</dd>
              </div>
              <div>
                <dt>Rule set</dt>
                <dd>{versions.ruleSetVersion}</dd>
              </div>
            </dl>
          </details>
        </div>
      </details>
    </div>
  );
}

/** Lists each clue returned by the analysis system without inferring its emotion. */
function CueTable({ cueSpans }: { cueSpans: CueSpan[] }) {
  const sorted = [...cueSpans].sort((a, b) => a.startMs - b.startMs);

  return (
    <section className="analysis-cue-section" aria-labelledby="cue-table-heading">
      <h3 id="cue-table-heading">Words and sounds that stood out</h3>
      {sorted.length ? (
        <div className="cue-table-wrap" tabIndex={0} aria-label="Flagged words and sounds">
          <table className="cue-table">
            <caption className="sr-only">Words and sounds that stood out</caption>
            <thead>
              <tr>
                <th scope="col">Word or sound</th>
                <th scope="col">From</th>
                <th scope="col">Why it was flagged</th>
                <th scope="col">At</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((span, index) => (
                <tr key={`${span.source}-${span.startMs}-${span.endMs}-${index}`}>
                  <th scope="row">{span.value}</th>
                  <td>
                    <span className={`cue-source cue-source-${span.source}`}>
                      {span.source === 'acoustic' ? 'Voice' : 'Words'}
                    </span>
                  </td>
                  <td>{humanizeCue(span.cue)}</td>
                  <td className="cue-time">
                    {formatSeconds(span.startMs)}–{formatSeconds(span.endMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="analysis-empty-value">No specific words or sounds were flagged.</p>
      )}
    </section>
  );
}

/* ---------- Helpers ---------- */

/** Sorts by the real returned scores, highest first. Ties keep a stable order. */
function rankEmotions(scores: EmotionScores) {
  return classificationKeys
    .map((classification) => ({ classification, probability: scores[classification] }))
    .sort(
      (a, b) =>
        b.probability - a.probability ||
        classificationKeys.indexOf(a.classification) - classificationKeys.indexOf(b.classification),
    );
}

/**
 * Only describes cues the backend actually returned. Unknown cues fall back to
 * the raw value, so nothing is invented.
 */
function describeVoiceCue(span: CueSpan): string {
  const cue = span.cue.toLowerCase();
  const value = span.value.toLowerCase();

  if (cue.includes('pitch')) {
    if (value.includes('rising')) {
      return 'Your pitch rose during the recording. Pitch movement is an acoustic clue, not proof of excitement.';
    }
    if (value.includes('falling')) {
      return 'Your pitch dropped during the recording. This describes the sound pattern, not your overall mood.';
    }
    if (value.includes('flat')) {
      return 'Your pitch stayed steady with little change during the recording.';
    }
    return `Pitch pattern: ${span.value}.`;
  }

  return `${humanizeCue(span.cue)}: ${span.value}.`;
}

function humanizeCue(cue: string): string {
  const knownCues: Record<string, string> = {
    asr_transcript: 'Auto-generated transcript',
    user_reviewed_transcript: 'Reviewed transcript',
    lexical_emotion: 'Emotion-related word',
    lexical_profanity: 'Profanity',
    prosodic_energy_rate: 'Speaking energy and rate',
  };
  const knownCue = knownCues[cue.toLowerCase()];
  if (knownCue) return knownCue;

  const text = cue.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function describeResearchRule(id: string, description: string): { title: string; detail: string } {
  const titles: Record<string, string> = {
    LEXICAL_NEGATION: 'Negation near an emotion-related phrase',
    LEXICAL_MODIFIER: 'Intensity word near an emotion-related phrase',
    LEXICAL_PROFANITY: 'Profanity cue',
    LEXICAL_POLITENESS: 'Polite-language cue',
    LEXICAL_EMOTION: 'Emotion-related word or phrase',
    CODE_SWITCH_TOKEN_LID: 'Filipino-English code-switching',
    PROSODIC_ENERGY_RATE: 'Voice energy and speaking rate',
    CONTRAST_POST_CLAUSE: 'Emotion after a contrast word',
    CONTRADICTION_RECALIBRATION: 'Neural and symbolic results disagree',
    NEURAL_RULE_AGREEMENT: 'Neural prediction and rule evidence agree',
  };
  const title = Object.entries(titles).find(([prefix]) => id.toUpperCase().startsWith(prefix))?.[1];
  return { title: title ?? id, detail: description };
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatAnalysisAccountName(email: string): string {
  const localPart = email.split('@')[0]?.trim();
  if (!localPart) return 'Private account';

  return localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatAnalysisDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
