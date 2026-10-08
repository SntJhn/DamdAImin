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
  ChevronDown,
  CircleCheck,
  FileText,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Mic2,
} from 'lucide-react';

import type { AnalysisResource, AnalysisResult, EmotionClassification } from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';
import { getCueScoreAdjustments, getRuleSignals } from '../lib/analysis-evidence';
import {
  describeLayerScores,
  formatClassification,
  formatProbability,
  formatProbabilityDistribution,
  formatScoreDelta,
  getAnalysisOutcomePresentation,
  getFusionWeightLabels,
} from '../lib/analysis-result';
import { ScoreChangeChart } from './score-change-chart';

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
                <AnalysisRecord result={analysis.result} createdAt={analysis.createdAt} />
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

function AnalysisRecord({ result, createdAt }: { result: AnalysisResult; createdAt: string }) {
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
          weights={getFusionWeightLabels(result)}
        />
      ) : null}

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
            <h2 id="traceability-heading">How DamdAImin Reached This Result</h2>
          </div>
        </div>

        <TechnicalTraceView
          trace={result.technicalTrace}
          finalScores={result.confidence}
          classification={classification}
        />
      </section>

      {classification ? (
        <ScoreChangeChart
          key={createdAt}
          trace={result.technicalTrace}
          classification={classification}
        >
          <EmotionScoreBreakdown trace={result.technicalTrace} finalScores={result.confidence} />
        </ScoreChangeChart>
      ) : null}
      <TechnicalDetails
        trace={result.technicalTrace}
        transcript={result.transcript}
        finalScores={result.confidence}
        finalPrediction={classificationLabel ?? 'No definitive classification'}
        inconclusiveScores={classification ? undefined : result.confidence}
        versions={{
          contractVersion: result.contractVersion,
          schemaVersion: result.schemaVersion,
          modelVersion: result.modelVersion,
          preprocessingVersion: result.preprocessingVersion,
          ruleSetVersion: result.ruleSetVersion,
        }}
      />
    </article>
  );
}

/* ---------- Layer comparison: Neural (audio), Symbolic (text), Combined ---------- */

function LayerComparison({
  neural,
  symbolic,
  combined,
  weights,
}: {
  neural: EmotionScores;
  symbolic?: EmotionScores;
  combined: EmotionScores;
  weights?: { audio: string; text: string };
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
          tag={weights ? `Audio: ${weights.audio}` : 'Audio'}
          tagDescription={weights ? 'Audio weight in the combined result' : undefined}
          description="Listens to how you sound."
          scores={neural}
          order={order}
        />
        <LayerColumn
          title="Symbolic Layer"
          tag={weights ? `Text: ${weights.text}` : 'Text'}
          tagDescription={weights ? 'Text weight in the combined result' : undefined}
          description="Reads your words using research rules."
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
      {symbolic ? (
        <p className="analysis-layer-description">
          {describeLayerScores('The symbolic layer', symbolic)}
        </p>
      ) : null}
    </section>
  );
}

function LayerColumn({
  title,
  tag,
  tagDescription,
  description,
  scores,
  order,
  highlighted = false,
}: {
  title: string;
  tag: string;
  tagDescription?: string;
  description: string;
  scores?: EmotionScores;
  order: EmotionClassification[];
  highlighted?: boolean;
}) {
  const formattedScores = scores
    ? formatProbabilityDistribution(order.map((classification) => scores[classification]))
    : [];
  return (
    <section
      className={`analysis-result-confidence-model${highlighted ? ` analysis-result-confidence-model--final analysis-result-confidence-model--${order[0]}` : ''}`}
      aria-label={title}
    >
      <div className="analysis-layer-heading">
        <h3>{title}</h3>
        <span className="analysis-layer-tag" title={tagDescription}>
          {tag}
        </span>
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
                <strong>{formattedScores[index]}</strong>
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

/* ---------- Evidence: overview, clue table, technical details ---------- */

function TechnicalTraceView({
  trace,
  finalScores,
  classification,
}: {
  trace: AnalysisResult['technicalTrace'];
  finalScores: EmotionScores;
  classification?: EmotionClassification;
}) {
  const cueCount = trace.cueSpans.filter(
    (span) => !['ASR_TRANSCRIPT', 'USER_REVIEWED_TRANSCRIPT'].includes(span.cue.toUpperCase()),
  ).length;
  const ruleCount = trace.activatedRules.length;
  const audioScore = classification ? trace.probabilities.before[classification] : undefined;
  const symbolicScore = classification ? trace.probabilities.symbolic?.[classification] : undefined;
  const finalScore = classification ? finalScores[classification] : undefined;
  const resultCopy =
    audioScore === undefined || classification === undefined
      ? 'The evidence did not favor one emotion clearly enough.'
      : `Audio layer: ${formatProbability(audioScore)}. ${symbolicScore === undefined ? `Combined: ${formatProbability(finalScore ?? audioScore)}.` : `Symbolic: ${formatProbability(symbolicScore)}.`}`;

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
              {cueCount ? 'that shaped the result.' : 'No specific words or sounds were flagged.'}
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
                ? 'that adjusted the emotion scores.'
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
                ? `${formatProbability(finalScore)} Final Confidence`
                : 'Inconclusive'}
            </b>
            <p>{resultCopy}</p>
          </div>
        </li>
      </ol>

      <CueTable cueSpans={trace.cueSpans} scoreAdjustments={trace.scoreAdjustments} />
    </div>
  );
}

function EmotionScoreBreakdown({
  trace,
  finalScores,
}: {
  trace: AnalysisResult['technicalTrace'];
  finalScores: EmotionScores;
}) {
  return (
    <section className="sjc-breakdown" aria-labelledby="probability-changes-heading">
      <div className="analysis-trace-card-heading">
        <h3 id="probability-changes-heading">Scores before and after clue adjustments</h3>
      </div>
      <div
        className="probability-table-wrap"
        tabIndex={0}
        aria-label="Before-and-after probabilities table"
      >
        <table className="probability-table">
          <caption className="sr-only">Emotion scores before and after clue adjustments</caption>
          <thead>
            <tr>
              <th scope="col">Emotion</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {classificationKeys.map((probabilityClassification) => {
              const before = trace.probabilities.before[probabilityClassification];
              const after = finalScores[probabilityClassification];
              return (
                <tr key={probabilityClassification}>
                  <th scope="row">{formatClassification(probabilityClassification)}</th>
                  <td>{formatProbability(before)}</td>
                  <td>{formatProbability(after)}</td>
                  <td>{formatScoreDelta(after - before)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TechnicalDetails({
  trace,
  transcript,
  finalScores,
  finalPrediction,
  inconclusiveScores,
  versions,
}: {
  trace: AnalysisResult['technicalTrace'];
  transcript: string;
  finalScores: EmotionScores;
  finalPrediction: string;
  inconclusiveScores?: EmotionScores;
  versions: Pick<
    AnalysisResult,
    'contractVersion' | 'schemaVersion' | 'modelVersion' | 'preprocessingVersion' | 'ruleSetVersion'
  >;
}) {
  return (
    <details className="analysis-trace-technical">
      <summary>
        <span>See more technical details</span>
        <ChevronDown className="analysis-trace-technical-toggle" size={18} aria-hidden="true" />
      </summary>

      <div className="analysis-trace-technical-body">
        <RuleSignalSummary trace={trace} />
        <ModuleOutputs
          trace={trace}
          transcript={transcript}
          finalScores={finalScores}
          finalPrediction={finalPrediction}
        />
        {inconclusiveScores ? (
          <EmotionScoreBreakdown trace={trace} finalScores={inconclusiveScores} />
        ) : null}

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
  );
}

function ModuleOutputs({
  trace,
  transcript,
  finalScores,
  finalPrediction,
}: {
  trace: AnalysisResult['technicalTrace'];
  transcript: string;
  finalScores: EmotionScores;
  finalPrediction: string;
}) {
  const outputs = trace.moduleOutputs;
  const weights = trace.fusionWeights;
  const adjustments = trace.scoreAdjustments;
  const symbolicCueSpans = trace.cueSpans.filter(
    (span) => !['asr_transcript', 'user_reviewed_transcript'].includes(span.cue.toLowerCase()),
  );
  const hasSymbolicCues = symbolicCueSpans.length > 0;

  return (
    <details className="analysis-module-outputs">
      <summary>
        <span>
          <strong>Module outputs</strong>
          <small>View the intermediate outputs produced during analysis.</small>
        </span>
        <ChevronDown className="analysis-module-outputs-toggle" size={18} aria-hidden="true" />
      </summary>

      <div className="analysis-module-outputs-body">
        <section className="analysis-module-output" aria-labelledby="module-audio-heading">
          <h3 id="module-audio-heading">Audio preprocessing</h3>
          {outputs ? (
            <dl className="analysis-module-metadata">
              <div>
                <dt>Input</dt>
                <dd>{outputs.audioPreprocessing.inputFormat}</dd>
              </div>
              <div>
                <dt>Sample rate</dt>
                <dd>{formatSampleRate(outputs.audioPreprocessing.sampleRateHz)}</dd>
              </div>
              <div>
                <dt>Channels</dt>
                <dd>
                  {outputs.audioPreprocessing.channels === 1
                    ? 'Mono'
                    : outputs.audioPreprocessing.channels}
                </dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{outputs.audioPreprocessing.durationSeconds.toFixed(1)} seconds</dd>
              </div>
              <div>
                <dt>Processed audio</dt>
                <dd>{formatSampleRate(outputs.audioPreprocessing.processedSampleRateHz)}, mono</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{outputs.audioPreprocessing.status}</dd>
              </div>
            </dl>
          ) : (
            <p className="analysis-empty-value">
              Audio preprocessing details are unavailable for this saved result.
            </p>
          )}
        </section>

        <section className="analysis-module-output" aria-labelledby="module-spectrogram-heading">
          <h3 id="module-spectrogram-heading">Log-Mel spectrogram</h3>
          {outputs?.logMelSpectrogram.dataUrl ? (
            <figure className="analysis-spectrogram">
              <div className="analysis-spectrogram-plot">
                <span className="analysis-spectrogram-y-label">Frequency / Mel scale</span>
                <img
                  src={outputs.logMelSpectrogram.dataUrl}
                  alt={`${outputs.logMelSpectrogram.representation} spectrogram generated from the uploaded audio`}
                />
              </div>
              <figcaption>
                Time (seconds) · 0–{outputs.logMelSpectrogram.durationSeconds.toFixed(1)}
              </figcaption>
              <div className="analysis-spectrogram-legend" aria-label="Color intensity legend">
                <span>Lower energy</span>
                <span className="analysis-spectrogram-color-scale" aria-hidden="true" />
                <span>Higher energy</span>
              </div>
            </figure>
          ) : (
            <p className="analysis-empty-value">
              The spectrogram is unavailable for this saved result.
            </p>
          )}
          <p className="analysis-module-note">
            Shows how audio energy is distributed over time and Mel-frequency bands. The image
            displays the base static Log-Mel representation used alongside delta and delta-delta
            features by the neural model. Display contrast is scaled for visibility; the model uses
            the original feature values with its checkpoint normalization.
          </p>
        </section>

        <section className="analysis-module-output" aria-labelledby="module-acoustic-heading">
          <h3 id="module-acoustic-heading">Acoustic / prosodic features</h3>
          {outputs ? (
            <dl className="analysis-module-metadata">
              <div>
                <dt>RMS energy</dt>
                <dd>{outputs.acousticFeatures.rmsEnergy.toFixed(4)}</dd>
              </div>
              <div>
                <dt>Estimated speaking rate</dt>
                <dd>
                  {outputs.acousticFeatures.estimatedSpeakingRateTokensPerSecond.toFixed(2)}{' '}
                  transcript tokens/second
                </dd>
              </div>
            </dl>
          ) : (
            <p className="analysis-empty-value">
              Acoustic feature values are unavailable for this saved result.
            </p>
          )}
          <p className="analysis-module-note">
            Speaking rate is estimated from transcript token count and recording duration. Pitch is
            not currently exposed by this pipeline.
          </p>
        </section>

        <section className="analysis-module-output" aria-labelledby="module-neural-heading">
          <h3 id="module-neural-heading">Neural model output</h3>
          <p className="analysis-module-label">
            Neural / Audio probabilities · before symbolic fusion
          </p>
          <EmotionDistribution scores={trace.probabilities.before} />
        </section>

        <section className="analysis-module-output" aria-labelledby="module-transcript-heading">
          <h3 id="module-transcript-heading">Transcript / ASR output</h3>
          <blockquote className="analysis-module-transcript">
            {transcript || 'No transcript was used for this analysis.'}
          </blockquote>
        </section>

        <section className="analysis-module-output" aria-labelledby="module-symbolic-rules-heading">
          <h3 id="module-symbolic-rules-heading">Symbolic rule output</h3>
          {hasSymbolicCues ? (
            <div className="analysis-module-rule-list">
              {adjustments.length
                ? adjustments.map((adjustment, index) => {
                    const span = symbolicCueSpans.find((item) => item.value === adjustment.cue);
                    const hasPreciseSpan =
                      span &&
                      outputs &&
                      (span.startMs > 0 ||
                        span.endMs < outputs.audioPreprocessing.durationSeconds * 1000 - 1);
                    return (
                      <div
                        className="analysis-module-rule"
                        key={`${adjustment.ruleId}-${adjustment.cue}-${index}`}
                      >
                        <strong>{adjustment.cue ?? 'Rule contribution'}</strong>
                        <span>
                          {adjustment.ruleCategory ?? 'Symbolic rule'} ·{' '}
                          {adjustment.ruleId ?? 'rule'}
                        </span>
                        <span>{formatClassification(adjustment.emotionClassification)}</span>
                        <span>{formatEvidence(adjustment.delta)}</span>
                        {hasPreciseSpan ? (
                          <small>
                            {span.startMs.toFixed(0)}–{span.endMs.toFixed(0)} ms · {span.source}
                          </small>
                        ) : null}
                      </div>
                    );
                  })
                : symbolicCueSpans.map((span, index) => (
                    <div className="analysis-module-rule" key={`${span.cue}-${index}`}>
                      <strong>{span.value}</strong>
                      <span>{humanizeCue(span.cue)}</span>
                      <span>Emotion contribution unavailable</span>
                      <span>Numeric score unavailable</span>
                    </div>
                  ))}
            </div>
          ) : (
            <div className="analysis-module-empty-cues">
              <strong>No symbolic cues detected.</strong>
              <p>
                {outputs && !outputs.hasSymbolicEvidence
                  ? 'The symbolic layer used the fallback distribution shown below. No context bonus was applied.'
                  : 'See the recorded symbolic distribution below.'}
              </p>
            </div>
          )}
          {outputs && !outputs.hasSymbolicEvidence && hasSymbolicCues ? (
            <p className="analysis-module-note">
              No emotion-scoring symbolic evidence was produced, so the engine used its fallback
              distribution and applied no context bonus.
            </p>
          ) : null}
        </section>

        <section className="analysis-module-output" aria-labelledby="module-symbolic-heading">
          <h3 id="module-symbolic-heading">Symbolic model output</h3>
          <p className="analysis-module-label">Symbolic / Text distribution · before fusion</p>
          {trace.probabilities.symbolic ? (
            <EmotionDistribution scores={trace.probabilities.symbolic} />
          ) : (
            <p className="analysis-empty-value">
              Symbolic probabilities are unavailable for this saved result.
            </p>
          )}
        </section>

        <section className="analysis-module-output" aria-labelledby="module-fusion-heading">
          <h3 id="module-fusion-heading">Fusion weights</h3>
          {weights ? (
            <>
              <dl className="analysis-module-metadata">
                <div>
                  <dt>Neural / Audio</dt>
                  <dd>{(weights.neural * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Symbolic / Text</dt>
                  <dd>{(weights.symbolic * 100).toFixed(1)}%</dd>
                </div>
              </dl>
              <p className="analysis-module-note">
                These weights determine how much each modality contributes to the final emotion
                score. They are not accuracy percentages.
              </p>
              {weights.reason ? (
                <p className="analysis-module-reason">
                  <strong>Why the weights changed:</strong> {weights.reason}
                </p>
              ) : null}
              {weights.neuralUncertainty !== undefined || weights.contextStrength !== undefined ? (
                <dl className="analysis-module-metadata analysis-module-metadata--compact">
                  {weights.neuralUncertainty !== undefined ? (
                    <div>
                      <dt>Neural uncertainty index</dt>
                      <dd>{(weights.neuralUncertainty * 100).toFixed(1)}%</dd>
                    </div>
                  ) : null}
                  {weights.contextStrength !== undefined ? (
                    <div>
                      <dt>Emotion context strength</dt>
                      <dd>{(weights.contextStrength * 100).toFixed(1)}%</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </>
          ) : (
            <p className="analysis-empty-value">
              Fusion weights are unavailable for this saved result.
            </p>
          )}
        </section>

        <section className="analysis-module-output" aria-labelledby="module-final-heading">
          <h3 id="module-final-heading">Final fused output</h3>
          <p className="analysis-module-label">Final / Fused emotion distribution</p>
          <EmotionDistribution scores={finalScores} />
          <p className="analysis-module-final-prediction">
            <strong>Predicted emotion:</strong> {finalPrediction}
          </p>
        </section>
      </div>
    </details>
  );
}

function EmotionDistribution({ scores }: { scores: EmotionScores }) {
  const rankedScores = rankEmotions(scores);
  const formattedScores = formatProbabilityDistribution(
    rankedScores.map(({ probability }) => probability),
  );
  return (
    <div className="analysis-module-distribution">
      {rankedScores.map(({ classification, probability }, index) => (
        <div className="analysis-module-score" key={classification}>
          <span>{formatClassification(classification)}</span>
          <span className="analysis-module-score-track" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, probability * 100))}%` }} />
          </span>
          <strong>{formattedScores[index]}</strong>
        </div>
      ))}
    </div>
  );
}

function formatSampleRate(sampleRateHz: number): string {
  return `${Number.isInteger(sampleRateHz / 1000) ? (sampleRateHz / 1000).toFixed(0) : (sampleRateHz / 1000).toFixed(1)} kHz`;
}

/** Lists each clue returned by the analysis system without inferring its emotion. */
function CueTable({
  cueSpans,
  scoreAdjustments,
}: {
  cueSpans: CueSpan[];
  scoreAdjustments: AnalysisResult['technicalTrace']['scoreAdjustments'];
}) {
  const transcriptCues = new Set(['asr_transcript', 'user_reviewed_transcript']);
  const sorted = cueSpans
    .filter((span) => !transcriptCues.has(span.cue.toLowerCase()))
    .sort((a, b) => a.startMs - b.startMs);
  const uniqueCues = sorted.filter(
    (span, index, spans) =>
      spans.findIndex(
        (candidate) =>
          candidate.source === span.source &&
          candidate.cue === span.cue &&
          candidate.value.toLowerCase() === span.value.toLowerCase(),
      ) === index,
  );

  return (
    <section className="analysis-cue-section" aria-labelledby="cue-table-heading">
      <h3 id="cue-table-heading">Clues That Stood Out</h3>
      {sorted.length ? (
        <div className="cue-table-wrap" tabIndex={0} aria-label="Flagged words and sounds">
          <table className="cue-table">
            <caption className="sr-only">Words, sounds, and system clues that stood out</caption>
            <colgroup>
              <col className="cue-table-col-phrase" />
              <col className="cue-table-col-reason" />
              <col className="cue-table-col-score" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Clue</th>
                <th scope="col">Why it was flagged</th>
                <th scope="col">Rule Evidence</th>
              </tr>
            </thead>
            <tbody>
              {uniqueCues.map((span, index) => (
                <tr key={`${span.source}-${span.startMs}-${span.endMs}-${index}`}>
                  <th scope="row">
                    <span className="cue-phrase">
                      {span.source === 'linguistic' &&
                      !['CONTRADICTION_RECALIBRATION', 'NEURAL_RULE_AGREEMENT'].includes(
                        span.cue.toUpperCase(),
                      )
                        ? `“${span.value}”`
                        : span.value}
                    </span>
                  </th>
                  <td>{humanizeCue(span.cue)}</td>
                  <td>
                    <CueScoreChanges
                      cue={span.value}
                      ruleId={span.cue}
                      scoreAdjustments={scoreAdjustments}
                    />
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

function CueScoreChanges({
  cue,
  ruleId,
  scoreAdjustments,
}: {
  cue: string;
  ruleId: string;
  scoreAdjustments: AnalysisResult['technicalTrace']['scoreAdjustments'];
}) {
  const matchingAdjustments = getCueScoreAdjustments(cue, ruleId, scoreAdjustments);

  if (!matchingAdjustments.length) {
    return <span className="cue-score-empty">Context cue or per-cue evidence unavailable</span>;
  }

  return (
    <div className="cue-score-changes">
      {matchingAdjustments.map((adjustment, index) => (
        <span
          className={`cue-score-change cue-score-change--${adjustment.emotionClassification}`}
          key={index}
        >
          {formatClassification(adjustment.emotionClassification)}{' '}
          {formatEvidence(adjustment.delta)}
        </span>
      ))}
    </div>
  );
}

function formatEvidence(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} evidence`;
}

function RuleSignalSummary({ trace }: { trace: AnalysisResult['technicalTrace'] }) {
  const signals = getRuleSignals(trace);
  const matchedSignals = signals.filter((signal) => signal.active).length;

  return (
    <section
      className="analysis-trace-card analysis-rule-signals"
      aria-labelledby="rule-signals-heading"
    >
      <div className="analysis-trace-card-heading">
        <p className="dashboard-card-kicker">Analysis signals</p>
        <h2 id="rule-signals-heading">What the symbolic rules picked up</h2>
        <p className="analysis-rule-signals-intro">
          {matchedSignals} of {signals.length} signal types matched. These include text, speaking,
          and model-comparison clues used to calculate symbolic evidence.
        </p>
      </div>
      <dl className="analysis-rule-signal-list">
        {signals.map((signal) => {
          const { activeRules, cues, adjustments, active } = signal;

          return (
            <div
              className={`analysis-rule-signal${active ? ' analysis-rule-signal--active' : ''}`}
              key={signal.id}
            >
              <dt className="analysis-rule-signal-heading">
                <strong>{signal.label}</strong>
                <span
                  className={`analysis-rule-signal-status${active ? ' analysis-rule-signal-status--active' : ''}`}
                >
                  {active ? 'Matched' : 'No match'}
                </span>
              </dt>
              <dd>
                <p className="analysis-rule-signal-explanation">{signal.explanation}</p>
                {active && cues.length ? (
                  <ul className="analysis-rule-signal-values">
                    {cues.map((span, index) => {
                      const cueAdjustments = getCueScoreAdjustments(
                        span.value,
                        signal.id,
                        adjustments,
                      );
                      return (
                        <li className="analysis-rule-signal-value" key={`${span.value}-${index}`}>
                          <span className="analysis-rule-signal-cue">“{span.value}”</span>
                          {cueAdjustments.map((adjustment, adjustmentIndex) => (
                            <span className="analysis-rule-signal-adjustment" key={adjustmentIndex}>
                              {formatClassification(adjustment.emotionClassification)} rule
                              adjustment {formatEvidence(adjustment.delta)}
                            </span>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {active && cues.length === 0 ? (
                  <p className="analysis-rule-signal-empty">
                    The rule matched, but no individual cue was returned.
                  </p>
                ) : null}
                {activeRules.length ? (
                  <details className="analysis-rule-signal-technical">
                    <summary>Technical rule ID{activeRules.length > 1 ? 's' : ''}</summary>
                    <ul>
                      {activeRules.map((rule) => (
                        <li key={rule.id}>
                          <code>{rule.id}</code>
                          {rule.description ? <span>{rule.description}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
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
