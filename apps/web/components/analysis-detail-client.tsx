'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { AnalysisResource, AnalysisResult, EmotionClassification } from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';
import {
  formatClassification,
  formatProbability,
  formatScoreDelta,
  getAnalysisLanguagePresentation,
  getAnalysisOutcomePresentation,
} from '../lib/analysis-result';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v2').replace(
  /\/$/,
  '',
);

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
          throw new Error('That Analysis could not be found.');
        }
        if (!response.ok) {
          throw new Error('Analysis status is unavailable right now.');
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
            loadError instanceof Error ? loadError.message : 'Analysis status is unavailable.',
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
            : `The Analysis could not be ${action === 'cancel' ? 'canceled' : 'retried'}.`,
        );
      }

      if (action === 'retry') {
        const retried = 'analysis' in body ? body.analysis : undefined;
        if (!retried?.id) throw new Error('The retry did not return a new Analysis.');
        router.replace(`/analyses/${retried.id}`);
        return;
      }

      setAnalysis(body as AnalysisResource);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : `The Analysis could not be ${action === 'cancel' ? 'canceled' : 'retried'}.`,
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteAnalysis() {
    if (!window.confirm('Delete this Analysis Record and its associated content?')) return;

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
            ? 'That Analysis could not be found.'
            : 'The Analysis could not be deleted. Try again.',
        );
      }

      router.replace('/history');
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'The Analysis could not be deleted. Try again.',
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
              <span className="dashboard-nav-icon dashboard-nav-icon-grid" aria-hidden="true" />
              Dashboard
            </Link>
            <Link className="dashboard-nav-item" href="/analyze">
              <span className="dashboard-nav-icon dashboard-nav-icon-mic" aria-hidden="true" />
              New Analysis
            </Link>
            <Link
              className="dashboard-nav-item dashboard-nav-item-active"
              href="/history#recent-analyses"
            >
              <span className="dashboard-nav-icon dashboard-nav-icon-bars" aria-hidden="true" />
              Analysis History
            </Link>
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
                ←
              </span>
              <span>Back to Analysis History</span>
            </span>
            <span className="dashboard-search-submit" aria-hidden="true">
              ↗
            </span>
          </Link>
          <span className="dashboard-toolbar-account">{accountEmail || 'Private account'}</span>
        </header>

        <div className="analysis-result-content">
          <div className="analysis-result-heading">
            <Link className="analysis-result-breadcrumb" href="/history">
              Analysis History <span aria-hidden="true">/</span> Record
            </Link>
            <p className="eyebrow">Private speech research</p>
            <h1 id="analysis-result-title">Analysis Record</h1>
            <p>Read the returned signal, then follow the evidence behind the prediction.</p>
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
                  analysisId={analysis.id}
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
            <p className="analysis-result-state" role="status">
              Checking the persisted Analysis stage…
            </p>
          ) : null}

          <Link className="analysis-result-history-link" href="/history">
            Return to History <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </main>
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
      ? 'Whisper and the research model are analyzing the speech signal. CPU processing can take a few minutes.'
      : 'Your recording is secured and waiting for the DamdAImin to begin.';

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
              <small>Private source secured</small>
            </span>
          </li>
          <li className="analysis-stage-step analysis-stage-step--current" aria-current="step">
            <span className="analysis-stage-marker" aria-hidden="true">
              2
            </span>
            <span>
              <strong>Research analysis</strong>
              <small>{isProcessing ? 'ASR + model active' : 'Waiting for engine'}</small>
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
            <strong>No action is needed.</strong>
            <span>You can leave this page; processing continues in the background.</span>
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
            Canceling removes the submitted Source Audio and later derived content.
          </p>
          <p id="analysis-delete-description" className="analysis-visually-hidden">
            Deletes this Analysis Record and its associated Source Audio.
          </p>
          <p className="analysis-result-id">Analysis ID: {analysis.id}</p>
        </div>
      </section>
    );
  }

  const message =
    analysis.status === 'failed'
      ? (analysis.failureMessage ?? 'The Research System could not complete this Analysis.')
      : analysis.status === 'canceled'
        ? 'This Analysis was canceled.'
        : 'The completed Analysis did not include a complete Analysis Record.';

  return (
    <section className="analysis-result-state-card" aria-labelledby="analysis-stage-title">
      <div className="analysis-result-state-icon" aria-hidden="true">
        {analysis.status === 'failed' ? '!' : analysis.status === 'canceled' ? '×' : '…'}
      </div>
      <div className="analysis-result-state-copy">
        <p className="dashboard-card-kicker">Persisted stage</p>
        <h2 id="analysis-stage-title">{analysis.stage}</h2>
        <p>{message}</p>
      </div>

      <div className="analysis-result-actions">
        {analysis.status === 'failed' ? (
          analysis.retryAvailable ? (
            <button
              className="analysis-result-button analysis-result-button-primary"
              type="button"
              disabled={actionBusy}
              onClick={onRetry}
            >
              {actionBusy ? 'Preparing retry…' : 'Retry Analysis'}
            </button>
          ) : (
            <p>Retry is unavailable because retained Source Audio is no longer present.</p>
          )
        ) : null}
        <button
          className="analysis-result-button analysis-result-button-secondary"
          type="button"
          disabled={actionBusy}
          onClick={onDelete}
        >
          {actionBusy ? 'Deleting…' : 'Delete Analysis'}
        </button>
        <p>Deletes this Analysis Record and its associated Source Audio.</p>
      </div>
      <p className="analysis-result-id">Analysis ID: {analysis.id}</p>
    </section>
  );
}

function AnalysisRecord({
  result,
  language,
  createdAt,
  analysisId,
}: {
  result: AnalysisResult;
  language: AnalysisResource['language'];
  createdAt: string;
  analysisId: string;
}) {
  const languagePresentation = getAnalysisLanguagePresentation(language);
  const outcomePresentation = getAnalysisOutcomePresentation(result.outcome);
  const classification = result.outcome === 'definitive' ? result.emotionClassification : undefined;

  return (
    <article className="analysis-record" aria-labelledby="analysis-outcome-title">
      <section className="analysis-result-hero" aria-label="Analysis outcome">
        <div className="analysis-result-hero-copy">
          <p className="analysis-result-hero-kicker">Completed Analysis</p>
          <h2 id="analysis-outcome-title">
            {classification ? formatClassification(classification) : outcomePresentation.label}
          </h2>
          <p>{outcomePresentation.description}</p>
          {/* {classificationProbability !== undefined ? (
            <div className="analysis-result-hero-confidence">
              <div>
                <span>Model confidence</span>
                <strong>{formatProbability(classificationProbability)}</strong>
              </div>
              <meter
                min="0"
                max="1"
                value={classificationProbability}
                aria-label={`${classification ? formatClassification(classification) : 'Result'} confidence`}
              />
            </div>
          ) : null} */}
        </div>
        <div className="analysis-result-hero-mark" aria-hidden="true">
          <span>{classification ? classification.charAt(0).toUpperCase() : '?'}</span>
        </div>
      </section>

      <section className="analysis-result-meta" aria-label="Analysis metadata">
        <div>
          <span className="analysis-result-meta-label">Language</span>
          <strong>{languagePresentation.label}</strong>
          <small>{languagePresentation.qualification}</small>
        </div>
        <div>
          <span className="analysis-result-meta-label">Recorded</span>
          <strong>{formatAnalysisDate(createdAt)}</strong>
          <small>Record {analysisId.slice(0, 8)}</small>
        </div>
        <div>
          <span className="analysis-result-meta-label">Research status</span>
          <strong>Returned</strong>
          <small>{languagePresentation.qualificationDescription}</small>
        </div>
      </section>

      <p className="analysis-result-scope">
        {classification
          ? 'This is a classification of expressed speech from this Analysis Record, based on the evidence returned by the Research System.'
          : 'This completed Analysis concerns expressed speech from this Analysis Record. It does not provide a definitive classification because the returned evidence was insufficient.'}
      </p>

      <div className="analysis-result-content-grid">
        <section className="analysis-result-panel" aria-labelledby="transcript-heading">
          <div className="analysis-result-panel-heading">
            <div>
              <p className="dashboard-card-kicker">Source signal</p>
              <h3 id="transcript-heading">Transcript used in analysis</h3>
            </div>
            <span className="analysis-result-panel-number" aria-hidden="true">
              01
            </span>
          </div>
          <blockquote className="analysis-transcript" aria-label="Transcript used in analysis">
            {result.transcript || (
              <span className="analysis-empty-value">No transcript was returned.</span>
            )}
          </blockquote>
        </section>

        <section className="analysis-result-panel" aria-labelledby="explanation-heading">
          <div className="analysis-result-panel-heading">
            <div>
              <p className="dashboard-card-kicker">Research explanation</p>
              <h3 id="explanation-heading">Why this result</h3>
            </div>
            <span className="analysis-result-panel-number" aria-hidden="true">
              02
            </span>
          </div>
          <p className="analysis-explanation">{result.explanation}</p>
        </section>
      </div>

      {classification ? (
        <ConfidenceBreakdown
          neural={result.technicalTrace.probabilities.before}
          symbolic={result.technicalTrace.probabilities.symbolic}
        />
      ) : null}

      <section className="analysis-result-trace" aria-labelledby="traceability-heading">
        <div className="analysis-result-section-heading">
          <div>
            <p className="dashboard-card-kicker">In plain language</p>
            <h2 id="traceability-heading">How DamdAImin reached this result</h2>
          </div>
        </div>
        <p className="analysis-result-trace-intro">
          The system looked for clues in the speech, checked for matching research rules, and
          calculated the final emotion scores.
        </p>
        <TechnicalTraceView
          trace={result.technicalTrace}
          classification={classification}
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

const classificationKeys = ['happiness', 'sadness', 'anger', 'neutrality'] as const;

function ConfidenceBreakdown({
  neural,
  symbolic,
}: {
  neural: AnalysisResult['confidence'];
  symbolic?: AnalysisResult['confidence'];
}) {
  return (
    <section className="analysis-result-confidence" aria-labelledby="confidence-heading">
      <div className="analysis-result-section-heading">
        <div>
          <p className="dashboard-card-kicker">Layer comparison</p>
          <h2 id="confidence-heading">Neural and symbolic probabilities</h2>
        </div>
        <p>
          When a rule supports the neural model’s top emotion, that class receives an agreement
          boost. If adjusted rule scores cancel out, the symbolic distribution falls back to an
          even split.
        </p>
      </div>
      <div className="analysis-result-confidence-grid">
        <ConfidenceColumn title="Neural" confidence={neural} />
        <ConfidenceColumn title="Symbolic + agreement" confidence={symbolic} />
      </div>
    </section>
  );
}

function ConfidenceColumn({
  title,
  confidence,
}: {
  title: string;
  confidence?: AnalysisResult['confidence'];
}) {
  return (
    <section className="analysis-result-confidence-model" aria-label={title + ' probabilities'}>
      <h3>{title}</h3>
      {confidence ? (
        <ul className="analysis-result-confidence-list">
          {classificationKeys.map((classification) => {
            const probability = confidence[classification];
            return (
              <li key={classification}>
                <div className="analysis-result-confidence-label">
                  <span>{formatClassification(classification)}</span>
                  <strong>{formatProbability(probability)}</strong>
                </div>
                <meter
                  min="0"
                  max="1"
                  value={probability}
                  aria-label={title + ' ' + formatClassification(classification) + ' probability'}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="analysis-result-confidence-unavailable">
          Symbolic probabilities were not recorded for this analysis.
        </p>
      )}
    </section>
  );
}

function TechnicalTraceView({
  trace,
  classification,
  versions,
}: {
  trace: AnalysisResult['technicalTrace'];
  classification?: EmotionClassification;
  versions: Pick<
    AnalysisResult,
    'contractVersion' | 'schemaVersion' | 'modelVersion' | 'preprocessingVersion' | 'ruleSetVersion'
  >;
}) {
  const cueCount = trace.cueSpans.length;
  const ruleCount = trace.activatedRules.length;
  const resultBefore = classification ? trace.probabilities.before[classification] : undefined;
  const resultAfter = classification ? trace.probabilities.after[classification] : undefined;
  const resultChangeCopy =
    resultBefore === undefined || resultAfter === undefined || classification === undefined
      ? 'The evidence did not favor one emotion clearly enough.'
      : 'For ' +
        formatClassification(classification) +
        ', the neural model assigned ' +
        formatProbability(resultBefore) +
        '; the final blend assigned ' +
        formatProbability(resultAfter) +
        '.';

  return (
    <div className="analysis-trace-body">
      <ol className="analysis-trace-overview" aria-label="How the system reached the result">
        <li>
          <span className="analysis-trace-overview-step">Speech</span>
          <strong>{cueCount}</strong>
          <div>
            <b>{cueCount === 1 ? 'clue found' : 'clues found'}</b>
            <p>
              {cueCount
                ? 'The system marked moments in the voice or words.'
                : 'No specific speech clues were returned.'}
            </p>
          </div>
        </li>
        <li>
          <span className="analysis-trace-overview-step">Rules</span>
          <strong>{ruleCount}</strong>
          <div>
            <b>{ruleCount === 1 ? 'rule activated' : 'rules activated'}</b>
            <p>
              {ruleCount
                ? 'Research rules changed the emotion scores.'
                : 'No activated research rules were returned.'}
            </p>
          </div>
        </li>
        <li className="analysis-trace-overview-result">
          <span className="analysis-trace-overview-step">Result</span>
          <strong>
            {classification ? formatClassification(classification) : 'No clear result'}
          </strong>
          <div>
            <b>
              {resultAfter !== undefined
                ? `${formatProbability(resultAfter)} final score`
                : 'Inconclusive'}
            </b>
            <p>{resultChangeCopy}</p>
          </div>
        </li>
      </ol>

      <details className="analysis-trace-technical">
        <summary>
          <span>
            <strong>View technical evidence</strong>
            <small>Cue timing, rule IDs, score changes, and system versions</small>
          </span>
          <span className="analysis-trace-technical-toggle" aria-hidden="true">
            +
          </span>
        </summary>

        <div className="analysis-trace-technical-body">
          <p className="analysis-trace-note">
            This evidence is shown as returned by the Research System. It does not connect an
            individual speech clue to an individual rule because that mapping was not returned.
          </p>

          <div className="analysis-trace-columns">
            <section className="analysis-trace-card" aria-labelledby="cue-spans-heading">
              <div className="analysis-trace-card-heading">
                <p className="dashboard-card-kicker">Signal input</p>
                <h3 id="cue-spans-heading">Detected speech clues</h3>
              </div>
              {trace.cueSpans.length ? (
                <ul className="analysis-trace-list">
                  {trace.cueSpans.map((span, cueIndex) => (
                    <li key={`${span.source}-${span.startMs}-${span.endMs}-${span.cue}-${cueIndex}`}>
                      <div className="analysis-trace-item-heading">
                        <strong>{span.cue}</strong>
                        <span>{span.source}</span>
                      </div>
                      <p>{span.value}</p>
                      <small>
                        {span.startMs}–{span.endMs} ms
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-empty-value">No speech clues were returned.</p>
              )}
            </section>

            <section className="analysis-trace-card" aria-labelledby="activated-rules-heading">
              <div className="analysis-trace-card-heading">
                <p className="dashboard-card-kicker">Symbolic layer</p>
                <h3 id="activated-rules-heading">Rules the system activated</h3>
              </div>
              {trace.activatedRules.length ? (
                <ul className="analysis-trace-list">
                  {trace.activatedRules.map((rule) => (
                    <li key={rule.id}>
                      <strong>{rule.id}</strong>
                      <p>{rule.description}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-empty-value">No rules were activated.</p>
              )}
            </section>

            <section className="analysis-trace-card" aria-labelledby="score-adjustments-heading">
              <div className="analysis-trace-card-heading">
                <p className="dashboard-card-kicker">Rule evidence</p>
                <h3 id="score-adjustments-heading">Raw symbolic score signals</h3>
              </div>
              {trace.scoreAdjustments.length ? (
                <ul className="analysis-trace-list">
                  {trace.scoreAdjustments.map((adjustment, index) => (
                    <li key={`${adjustment.emotionClassification}-${index}`}>
                      <div className="analysis-trace-item-heading">
                        <strong>{formatClassification(adjustment.emotionClassification)}</strong>
                        <span>{`${adjustment.delta >= 0 ? "+" : ""}${adjustment.delta.toFixed(2)} score`}</span>
                      </div>
                      <p>{adjustment.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-empty-value">No rule score signals were returned.</p>
              )}
            </section>
          </div>

          <section
            className="analysis-trace-probabilities"
            aria-labelledby="probability-changes-heading"
          >
            <div className="analysis-trace-card-heading">
              <p className="dashboard-card-kicker">Prediction output</p>
              <h3 id="probability-changes-heading">Before-and-after probabilities</h3>
            </div>
            <div
              className="probability-table-wrap"
              tabIndex={0}
              aria-label="Before-and-after probabilities table"
            >
              <table className="probability-table">
                <caption className="sr-only">
                  Returned probabilities before and after rule processing
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Classification</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {classificationKeys.map((probabilityClassification) => {
                    const before = trace.probabilities.before[probabilityClassification];
                    const after = trace.probabilities.after[probabilityClassification];
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

          <details className="analysis-trace-versions">
            <summary>
              Version identifiers <span>Returned pipeline versions</span>
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
