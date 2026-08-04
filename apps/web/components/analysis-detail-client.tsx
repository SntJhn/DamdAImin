'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { AnalysisResource, AnalysisResult } from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';
import {
  formatClassification,
  formatProbability,
  formatScoreDelta,
  getAnalysisLanguagePresentation,
  getAnalysisOutcomePresentation,
} from '../lib/analysis-result';

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
        <h1 id="analysis-result-title">Analysis Record</h1>
        {error ? (
          <p className="form-message" role="alert">
            {error}
          </p>
        ) : null}
        {analysis ? (
          <div className="analysis-result-card" aria-live="polite">
            {analysis.status === 'completed' && analysis.result ? (
              <AnalysisRecord result={analysis.result} language={analysis.language} />
            ) : (
              <>
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
                  {analysis.status === 'completed'
                    ? 'The completed Analysis did not include a complete Analysis Record.'
                    : null}
                </p>
              </>
            )}
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

function AnalysisRecord({
  result,
  language,
}: {
  result: AnalysisResult;
  language: AnalysisResource['language'];
}) {
  const languagePresentation = getAnalysisLanguagePresentation(language);
  const outcomePresentation = getAnalysisOutcomePresentation(result.outcome);
  const classification = result.outcome === 'definitive' ? result.emotionClassification : undefined;

  return (
    <article className="analysis-record" aria-labelledby="analysis-outcome-title">
      <div className="analysis-record-header">
        <div>
          <p className="card-kicker">Completed Analysis</p>
          <h2 id="analysis-outcome-title">{outcomePresentation.label}</h2>
        </div>
        <div
          className="analysis-language-qualification"
          aria-label={`${languagePresentation.label} language qualification`}
        >
          <span className="analysis-language-label">{languagePresentation.label}</span>
          <span className="analysis-language-badge">{languagePresentation.qualification}</span>
          <span>{languagePresentation.qualificationDescription}</span>
        </div>
      </div>

      <p className="analysis-outcome-copy">{outcomePresentation.description}</p>
      <p className="analysis-speech-scope">
        {classification
          ? 'This is a classification of expressed speech from this Analysis Record, based on the evidence returned by the Research System.'
          : 'This completed Analysis concerns expressed speech from this Analysis Record. It does not provide a definitive classification because the returned evidence was insufficient.'}
      </p>

      {classification ? (
        <section className="analysis-classification" aria-labelledby="classification-heading">
          <p className="card-kicker" id="classification-heading">
            Emotion Classification
          </p>
          <strong aria-label={formatClassification(classification)}>{classification}</strong>
          <p>Classification returned for the expressed speech in this sample.</p>
        </section>
      ) : (
        <p className="analysis-inconclusive-note">
          No definitive classification is shown for this completed Analysis.
        </p>
      )}

      <section className="analysis-record-section" aria-labelledby="transcript-heading">
        <p className="card-kicker" id="transcript-heading">
          Unedited Transcript
        </p>
        <blockquote className="analysis-transcript" aria-label="Unedited Transcript">
          {result.transcript || (
            <span className="analysis-empty-value">No transcript was returned.</span>
          )}
        </blockquote>
      </section>

      <section className="analysis-record-section" aria-labelledby="explanation-heading">
        <p className="card-kicker" id="explanation-heading">
          Explanation
        </p>
        <p className="analysis-explanation">{result.explanation}</p>
      </section>

      {classification ? <ConfidenceBreakdown confidence={result.confidence} /> : null}

      <details className="technical-trace">
        <summary>
          <span>Technical Trace</span>
          <span className="technical-trace-summary-note">
            Returned research evidence and versions
          </span>
        </summary>
        <TechnicalTraceView
          trace={result.technicalTrace}
          versions={{
            contractVersion: result.contractVersion,
            schemaVersion: result.schemaVersion,
            modelVersion: result.modelVersion,
            preprocessingVersion: result.preprocessingVersion,
            ruleSetVersion: result.ruleSetVersion,
          }}
        />
      </details>
    </article>
  );
}

const classificationKeys = ['happiness', 'sadness', 'anger', 'neutrality'] as const;

function ConfidenceBreakdown({ confidence }: { confidence: AnalysisResult['confidence'] }) {
  return (
    <section className="analysis-confidence" aria-labelledby="confidence-heading">
      <div className="analysis-section-heading">
        <p className="card-kicker" id="confidence-heading">
          Confidence breakdown
        </p>
        <p>Returned probabilities for the definitive classification.</p>
      </div>
      <ul className="confidence-list">
        {classificationKeys.map((classification) => {
          const probability = confidence[classification];
          return (
            <li key={classification}>
              <div className="confidence-label">
                <span>{formatClassification(classification)}</span>
                <strong>{formatProbability(probability)}</strong>
              </div>
              <meter
                min="0"
                max="1"
                value={probability}
                aria-label={`${classification} probability`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TechnicalTraceView({
  trace,
  versions,
}: {
  trace: AnalysisResult['technicalTrace'];
  versions: Pick<
    AnalysisResult,
    'contractVersion' | 'schemaVersion' | 'modelVersion' | 'preprocessingVersion' | 'ruleSetVersion'
  >;
}) {
  return (
    <div className="technical-trace-body">
      <p className="technical-trace-intro">
        These fields are the returned cue spans, activated rules, score adjustments, probability
        changes, and version identifiers. No evidence is reconstructed in this view.
      </p>

      <section className="trace-section" aria-labelledby="cue-spans-heading">
        <h3 id="cue-spans-heading">Cue spans</h3>
        {trace.cueSpans.length ? (
          <ul className="trace-list">
            {trace.cueSpans.map((span) => (
              <li key={`${span.source}-${span.startMs}-${span.endMs}-${span.cue}`}>
                <div className="trace-item-heading">
                  <strong>{span.cue}</strong>
                  <span>{span.source}</span>
                </div>
                <p>
                  {span.value} · {span.startMs}–{span.endMs} ms
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="analysis-empty-value">No cue spans were returned.</p>
        )}
      </section>

      <section className="trace-section" aria-labelledby="activated-rules-heading">
        <h3 id="activated-rules-heading">Activated rules</h3>
        {trace.activatedRules.length ? (
          <ul className="trace-list">
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

      <section className="trace-section" aria-labelledby="score-adjustments-heading">
        <h3 id="score-adjustments-heading">Score adjustments</h3>
        {trace.scoreAdjustments.length ? (
          <ul className="trace-list">
            {trace.scoreAdjustments.map((adjustment, index) => (
              <li key={`${adjustment.emotionClassification}-${index}`}>
                <div className="trace-item-heading">
                  <strong>{formatClassification(adjustment.emotionClassification)}</strong>
                  <span>{formatScoreDelta(adjustment.delta)}</span>
                </div>
                <p>{adjustment.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="analysis-empty-value">No score adjustments were returned.</p>
        )}
      </section>

      <section className="trace-section" aria-labelledby="probability-changes-heading">
        <h3 id="probability-changes-heading">Before-and-after probabilities</h3>
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
              </tr>
            </thead>
            <tbody>
              {classificationKeys.map((classification) => (
                <tr key={classification}>
                  <th scope="row">{formatClassification(classification)}</th>
                  <td>{formatProbability(trace.probabilities.before[classification])}</td>
                  <td>{formatProbability(trace.probabilities.after[classification])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="trace-section" aria-labelledby="version-identifiers-heading">
        <h3 id="version-identifiers-heading">Version identifiers</h3>
        <dl className="version-list">
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
      </section>
    </div>
  );
}
