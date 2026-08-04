'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

import type { CreateAnalysisUploadResponse, AcceptedAnalysisResponse } from '@damdai/contracts';

import { authClient, getAuthToken } from '../lib/auth-client';
import { MicrophoneRecorder } from './microphone-recorder';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/$/,
  '',
);

export function AnalysisSubmitClient() {
  const router = useRouter();
  const [accountEmail, setAccountEmail] = useState('');
  const [language, setLanguage] = useState<'taglish' | 'english' | 'tagalog'>('taglish');
  const [inputMethod, setInputMethod] = useState<'microphone' | 'upload'>('microphone');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

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
        body: JSON.stringify({ language, contractVersion: 'taglish-v1' }),
      });
      if (uploadResponse.status === 401) {
        router.replace('/auth/sign-in?next=/analyze');
        return;
      }

      const uploadBody = (await uploadResponse.json()) as Partial<CreateAnalysisUploadResponse> & {
        error?: string;
        message?: string;
      };
      if (!uploadResponse.ok || typeof uploadBody.uploadUrl !== 'string') {
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

      const finalizeResponse = await fetch(`${apiBaseUrl}/analyses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ uploadId: uploadBody.uploadId }),
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
    setError('');
  }

  function selectSpeechSample(nextFile: File | null) {
    setFile(nextFile);
    if (nextFile) setError('');
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
      <section className="analysis-content" aria-labelledby="analysis-title">
        <div className="analysis-heading">
          <p className="eyebrow">New Analysis</p>
          <h1 id="analysis-title">One utterance. One honest signal.</h1>
          <p>
            Record in your browser or upload a WAV, then send one private Speech Sample through the
            same durable Analysis path.
          </p>
        </div>
        <div className="analysis-layout">
          <form className="analysis-card auth-form" onSubmit={submit} noValidate>
            <div className="form-heading">
              <p className="card-kicker">Input</p>
              <h2>Choose the language and Speech Sample</h2>
            </div>
            <label className="field" htmlFor="analysis-language">
              <span>Analysis Language</span>
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
            <fieldset className="input-method">
              <legend>Speech Sample input</legend>
              <label>
                <input
                  type="radio"
                  name="input-method"
                  value="microphone"
                  checked={inputMethod === 'microphone'}
                  onChange={() => chooseInputMethod('microphone')}
                />
                Record with microphone
              </label>
              <label>
                <input
                  type="radio"
                  name="input-method"
                  value="upload"
                  checked={inputMethod === 'upload'}
                  onChange={() => chooseInputMethod('upload')}
                />
                Upload WAV
              </label>
            </fieldset>
            {inputMethod === 'microphone' ? (
              <MicrophoneRecorder
                disabled={busy}
                onDiscard={() => selectSpeechSample(null)}
                onRecordingReady={selectSpeechSample}
              />
            ) : (
              <label className="field" htmlFor="analysis-file">
                <span>WAV utterance</span>
                <input
                  id="analysis-file"
                  name="file"
                  type="file"
                  accept=".wav,audio/wav"
                  onChange={(event) => selectSpeechSample(event.target.files?.[0] ?? null)}
                />
                <small className="field-hint">{file?.name ?? 'No file selected'}</small>
              </label>
            )}
            {error ? (
              <p className="form-message" role="alert">
                {error}
              </p>
            ) : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Preparing Analysis…' : 'Submit Analysis'}
            </button>
          </form>
          <aside className="analysis-guidance" aria-label="Submission rules">
            <p className="card-kicker">Before you submit</p>
            <ul>
              <li>One Analysis contains one utterance.</li>
              <li>The provisional maximum is 20 seconds.</li>
              <li>The Research System owns the detectable-speech rule.</li>
              <li>The application imposes no arbitrary minimum duration.</li>
              <li>Long audio is not segmented into multiple Analyses.</li>
            </ul>
          </aside>
        </div>
      </section>
    </main>
  );
}
