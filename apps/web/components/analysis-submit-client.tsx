'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

import type { CreateAnalysisUploadResponse, AcceptedAnalysisResponse } from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';
import { MicrophoneRecorder } from './microphone-recorder';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v2').replace(
  /\/$/,
  '',
);

export function AnalysisSubmitClient() {
  const router = useRouter();
  const [accountEmail, setAccountEmail] = useState('');
  const [language, setLanguage] = useState<'taglish' | 'english' | 'tagalog'>('taglish');
  const [inputMethod, setInputMethod] = useState<'microphone' | 'upload'>('microphone');
  const [retainSourceAudio, setRetainSourceAudio] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [asrTranscriptGenerated, setAsrTranscriptGenerated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [transcriptionNotice, setTranscriptionNotice] = useState('');
  const [reviewingTranscript, setReviewingTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const session = await authClient.getSession();
      const user = session.data?.user;
      if (!user) {
        router.replace('/auth/sign-in?next=/analyze');
        return;
      }

      if (!user.emailVerified) {
        router.replace(`/auth/verify?email=${encodeURIComponent(user.email)}`);
        return;
      }

      if (!cancelled) setAccountEmail(user.email);
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!file) {
      setAudioPreviewUrl(null);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setAudioPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);

  async function queueAnalysis(token: string, uploadId: string, transcript: string) {
    const finalizeResponse = await fetch(`${apiBaseUrl}/analyses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ uploadId, transcript }),
    });
    if (finalizeResponse.status === 401) {
      router.replace('/auth/sign-in?next=/analyze');
      return;
    }

    const finalized = (await finalizeResponse.json()) as Partial<AcceptedAnalysisResponse> & {
      error?: string;
      message?: string;
    };
    if (!finalizeResponse.ok || !finalized.analysis?.id) {
      throw new Error(finalized.message ?? 'The WAV file was not accepted.');
    }

    router.replace(`/analyses/${finalized.analysis.id}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (reviewingTranscript) {
      if (!pendingUploadId) {
        setError('The uploaded recording is no longer available. Upload it again to continue.');
        return;
      }

      setBusy(true);
      try {
        const token = await getAuthToken();
        if (!token) {
          router.replace('/auth/sign-in?next=/analyze');
          return;
        }
        await queueAnalysis(token, pendingUploadId, transcriptDraft);
      } catch (submissionError) {
        setError(
          submissionError instanceof Error
            ? submissionError.message
            : 'The Analysis could not be submitted. Try again.',
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!file) {
      setError(
        inputMethod === 'microphone'
          ? 'Record one utterance before submitting.'
          : 'Choose one WAV utterance before submitting.',
      );
      return;
    }

    if (!file.name.toLowerCase().endsWith('.wav')) {
      setError('Only WAV audio files are supported.');
      return;
    }

    setBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        router.replace('/auth/sign-in?next=/analyze');
        return;
      }

      const uploadResponse = await fetch(`${apiBaseUrl}/analysis-uploads`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          language,
          contractVersion: 'taglish-v2',
          retainSourceAudio,
        }),
      });
      if (uploadResponse.status === 401) {
        router.replace('/auth/sign-in?next=/analyze');
        return;
      }

      const uploadBody = (await uploadResponse.json()) as Partial<CreateAnalysisUploadResponse> & {
        error?: string;
        message?: string;
      };
      if (
        !uploadResponse.ok ||
        typeof uploadBody.uploadUrl !== 'string' ||
        typeof uploadBody.uploadId !== 'string'
      ) {
        throw new Error(uploadBody.message ?? 'The upload could not be prepared.');
      }

      const upload = await fetch(uploadBody.uploadUrl, {
        method: uploadBody.uploadMethod ?? 'PUT',
        headers: uploadBody.uploadHeaders ?? { 'content-type': 'audio/wav' },
        body: file,
      });
      if (!upload.ok) {
        throw new Error('The WAV file could not be uploaded. Try again.');
      }

      setPendingUploadId(uploadBody.uploadId);
      try {
        const previewResponse = await fetch(
          `${apiBaseUrl}/analysis-uploads/${uploadBody.uploadId}/transcription-preview`,
          { method: 'POST', headers: { authorization: `Bearer ${token}` } },
        );
        if (previewResponse.status === 401) {
          router.replace('/auth/sign-in?next=/analyze');
          return;
        }

        const previewBody = (await previewResponse.json()) as {
          transcript?: unknown;
        };
        if (!previewResponse.ok || typeof previewBody.transcript !== 'string') {
          throw new Error('Transcription preview unavailable');
        }

        setTranscriptDraft(previewBody.transcript);
        setAsrTranscriptGenerated(true);
        setTranscriptionNotice(
          'Check names, slang, and code-switched words. You can correct the transcript before analysis.',
        );
      } catch {
        setTranscriptDraft('');
        setAsrTranscriptGenerated(false);
        setTranscriptionNotice(
          'Automatic transcription could not be generated. Type a transcript, or leave it blank to analyze the audio without language cues.',
        );
      }
      setReviewingTranscript(true);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'The Analysis could not be submitted. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await authClient.signOut();
    router.replace('/auth/sign-in');
  }

  function chooseInputMethod(method: 'microphone' | 'upload') {
    setInputMethod(method);
    setFile(null);
    setPendingUploadId(null);
    setTranscriptDraft('');
    setTranscriptionNotice('');
    setAsrTranscriptGenerated(false);
    setReviewingTranscript(false);
    setError('');
  }

  function selectSpeechSample(nextFile: File | null) {
    setFile(nextFile);
    setPendingUploadId(null);
    setTranscriptDraft('');
    setTranscriptionNotice('');
    setAsrTranscriptGenerated(false);
    setReviewingTranscript(false);
    if (nextFile) setError('');
  }

  const accountLabel = formatAnalysisAccountName(accountEmail);

  return (
    <main className="dashboard-page analysis-workspace-page">
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
            <Link className="dashboard-nav-item dashboard-nav-item-active" href="/analyze">
              <span className="dashboard-nav-icon dashboard-nav-icon-mic" aria-hidden="true" />
              New Analysis
            </Link>
            <Link className="dashboard-nav-item" href="/history#recent-analyses">
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

      <section className="dashboard-main" aria-labelledby="analysis-title">
        <header className="dashboard-toolbar">
          <Link
            className="dashboard-search analysis-search-link"
            href="/history"
            aria-label="Browse analysis history"
          >
            <span className="dashboard-search-field">
              <span className="dashboard-search-icon" aria-hidden="true">
                ⌕
              </span>
              <span>Search recordings, transcripts, emotions…</span>
            </span>
            <span className="dashboard-search-submit" aria-hidden="true">
              ↗
            </span>
          </Link>
          <span className="dashboard-toolbar-account">{accountEmail || 'Private account'}</span>
        </header>

        <div className="analysis-workspace-content">
          <div className="analysis-workspace-heading">
            <p className="eyebrow">New Analysis</p>
            <h1 id="analysis-title">
              Start an <span>emotion analysis.</span>
            </h1>
            <p>
              Turn one Taglish speech recording into a clear, explainable signal. Record directly or
              bring a WAV file from your device.
            </p>
          </div>

          <form className="analysis-intake-card" onSubmit={submit} noValidate>
            <header className="analysis-intake-header">
              <div>
                <p className="dashboard-card-kicker">VOICE INPUT</p>
                <h2>Give the model one honest moment.</h2>
                <p>
                  Speak naturally. We’ll listen for the acoustic and linguistic cues that shape the
                  emotion in your words.
                </p>
              </div>
              <Link className="analysis-close-link" href="/history" aria-label="Back to dashboard">
                ×
              </Link>
            </header>

            <section
              className="analysis-transcript-review"
              hidden={!reviewingTranscript}
              aria-labelledby="transcript-review-title"
            >
              <p className="analysis-panel-kicker">
                {asrTranscriptGenerated ? 'ASR TRANSCRIPT' : 'TRANSCRIPT ENTRY'}
              </p>
              <h3 id="transcript-review-title">Check the words before analysis.</h3>
              <p className="analysis-transcript-guidance">
                Correct names, Taglish spelling, and anything Whisper missed. The neural model reads
                the audio; this transcript is used by the symbolic language rules.
              </p>
              {file && audioPreviewUrl ? (
                <AudioPreview fileName={file.name} src={audioPreviewUrl} />
              ) : null}
              <label className="analysis-transcript-field" htmlFor="analysis-transcript">
                <span>
                  {asrTranscriptGenerated
                    ? 'ASR-generated transcript (editable)'
                    : 'Transcript text (editable)'}
                </span>
                <textarea
                  id="analysis-transcript"
                  name="transcript"
                  value={transcriptDraft}
                  maxLength={4000}
                  placeholder="Type the words that were spoken"
                  rows={6}
                  onChange={(event) => setTranscriptDraft(event.target.value)}
                />
              </label>
              <p className="analysis-transcription-notice" role="status">
                {transcriptionNotice}
              </p>
            </section>

            <div className="analysis-intake-body" hidden={reviewingTranscript}>
              <section className="analysis-capture-panel" aria-labelledby="capture-title">
                {inputMethod === 'upload' ? (
                  <div className="analysis-signal-visual" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <b>✦</b>
                  </div>
                ) : null}
                <div className="analysis-capture-copy">
                  <p className="analysis-panel-kicker">YOUR RECORDING</p>
                  <h3 id="capture-title">Say what you mean.</h3>
                  <p>One utterance is enough. Keep it natural and under 60 seconds.</p>
                </div>

                <fieldset className="analysis-mode-switch">
                  <legend>Choose an input method</legend>
                  <label className={inputMethod === 'microphone' ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="input-method"
                      value="microphone"
                      checked={inputMethod === 'microphone'}
                      onChange={() => chooseInputMethod('microphone')}
                    />
                    <span
                      className="analysis-mode-icon analysis-mode-icon-mic"
                      aria-hidden="true"
                    />
                    <span>
                      <strong>Record with microphone</strong>
                      <small>Use your voice</small>
                    </span>
                  </label>
                  <label className={inputMethod === 'upload' ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="input-method"
                      value="upload"
                      checked={inputMethod === 'upload'}
                      onChange={() => chooseInputMethod('upload')}
                    />
                    <span
                      className="analysis-mode-icon analysis-mode-icon-upload"
                      aria-hidden="true"
                    >
                      ↑
                    </span>
                    <span>
                      <strong>Upload a WAV</strong>
                      <small>Bring a recording</small>
                    </span>
                  </label>
                </fieldset>

                {inputMethod === 'microphone' ? (
                  <MicrophoneRecorder
                    disabled={busy}
                    onDiscard={() => selectSpeechSample(null)}
                    onRecordingReady={selectSpeechSample}
                  />
                ) : (
                  <label className="analysis-upload-field" htmlFor="analysis-file">
                    <span className="analysis-upload-icon" aria-hidden="true">
                      ↑
                    </span>
                    <span className="analysis-upload-copy">
                      <strong>{file?.name ?? 'Choose a WAV recording'}</strong>
                      <small>
                        {file ? 'Ready to submit' : 'Drop a .wav file here or browse your device'}
                      </small>
                    </span>
                    <input
                      id="analysis-file"
                      name="file"
                      type="file"
                      accept=".wav,audio/wav"
                      onChange={(event) => selectSpeechSample(event.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
                {file && audioPreviewUrl ? (
                  <AudioPreview fileName={file.name} src={audioPreviewUrl} />
                ) : null}
              </section>

              <aside className="analysis-options-panel" aria-label="Analysis options">
                <div className="analysis-option-heading">
                  <p className="analysis-panel-kicker">ANALYSIS OPTIONS</p>
                  <p>Set the context before you send your recording.</p>
                </div>
                <label className="analysis-option-field" htmlFor="analysis-language">
                  <span>Analysis language</span>
                  <select
                    id="analysis-language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value as typeof language)}
                  >
                    <option value="taglish">Taglish — validated</option>
                    <option value="english">English — experimental</option>
                    <option value="tagalog">Tagalog — experimental</option>
                  </select>
                </label>
                <label className="analysis-retention-field" htmlFor="retain-source-audio">
                  <input
                    id="retain-source-audio"
                    name="retainSourceAudio"
                    type="checkbox"
                    checked={retainSourceAudio}
                    onChange={(event) => setRetainSourceAudio(event.target.checked)}
                  />
                  <span>
                    <strong>Keep source audio</strong>
                    <small>
                      Optional. Keeps the WAV available after processing so a failed Analysis can be
                      retried.
                    </small>
                  </span>
                </label>
                <div className="analysis-rules" aria-label="Submission rules">
                  <p className="analysis-panel-kicker">BEFORE YOU SUBMIT</p>
                  <ul>
                    <li>One Analysis contains one utterance.</li>
                    <li>Maximum recording length is 60 seconds.</li>
                    <li>Long audio is not segmented into multiple Analyses.</li>
                    <li>There is no arbitrary minimum duration.</li>
                  </ul>
                </div>
              </aside>
            </div>

            <footer className="analysis-intake-footer">
              {error ? (
                <p className="form-message" role="alert">
                  {error}
                </p>
              ) : (
                <p>
                  {reviewingTranscript
                    ? 'Review the transcript, then run the analysis with your corrections.'
                    : 'Private by default. Your recording follows the retention choice above.'}
                </p>
              )}
              <button
                className="analysis-submit-button primary-button"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? reviewingTranscript
                    ? 'Queueing Analysis…'
                    : 'Transcribing audio…'
                  : reviewingTranscript
                    ? 'Run analysis'
                    : 'Generate transcript'}
                <span aria-hidden="true">↗</span>
              </button>
            </footer>
          </form>
        </div>
      </section>
    </main>
  );
}

function AudioPreview({ fileName, src }: { fileName: string; src: string }) {
  return (
    <section className="analysis-audio-preview" aria-label="Audio preview">
      <div className="analysis-audio-preview-heading">
        <p className="analysis-panel-kicker">AUDIO PREVIEW</p>
        <span>{fileName}</span>
      </div>
      <audio controls preload="metadata" src={src} aria-label="Play the selected recording">
        Audio playback is not supported in this browser.
      </audio>
    </section>
  );
}

function formatAnalysisAccountName(email: string): string {
  const localPart = email.split('@')[0]?.trim();
  if (!localPart) return 'Your workspace';

  return localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
