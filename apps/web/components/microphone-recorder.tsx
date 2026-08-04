'use client';

import { useEffect, useRef, useState } from 'react';

import {
  convertRecordingToWav,
  MAX_RECORDING_SECONDS,
  microphoneErrorMessage,
} from '../lib/recording-audio';

type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'converting' | 'ready';

interface MicrophoneRecorderProps {
  disabled?: boolean;
  onDiscard: () => void;
  onRecordingReady: (file: File) => void;
}

const captureMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export function MicrophoneRecorder({
  disabled = false,
  onDiscard,
  onRecordingReady,
}: MicrophoneRecorderProps) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardOnStopRef = useRef(false);
  const conversionGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  function releaseCaptureHardware(stopRecorder = false) {
    clearRecordingTimers(intervalRef, limitRef);
    const recorder = recorderRef.current;
    if (stopRecorder && recorder?.state === 'recording') recorder.stop();
    stopStream(streamRef.current);
    recorderRef.current = null;
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conversionGenerationRef.current += 1;
      discardOnStopRef.current = true;
      chunksRef.current = [];
      releaseCaptureHardware(true);
    };
  }, []);

  async function startRecording() {
    setError('');
    setElapsedSeconds(0);
    onDiscard();
    conversionGenerationRef.current += 1;
    discardOnStopRef.current = false;
    chunksRef.current = [];

    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setError(
        'Microphone recording is unavailable in this browser. Use a supported browser or upload a WAV file.',
      );
      return;
    }

    setStatus('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (permissionError) {
      if (mountedRef.current) {
        setStatus('idle');
        setError(microphoneErrorMessage(permissionError));
      }
      return;
    }

    if (!mountedRef.current) {
      stopStream(stream);
      return;
    }

    const mimeType = captureMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (recorderError) {
      stopStream(stream);
      setStatus('idle');
      setError(microphoneErrorMessage(recorderError));
      return;
    }

    const conversionGeneration = conversionGenerationRef.current;
    streamRef.current = stream;
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (!discardOnStopRef.current && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onerror = () => {
      discardOnStopRef.current = true;
      chunksRef.current = [];
      releaseCaptureHardware(true);
      if (mountedRef.current) {
        setStatus('idle');
        setError(
          'The microphone stopped unexpectedly. Check that it is connected, then record again.',
        );
      }
    };
    recorder.onstop = () => {
      releaseCaptureHardware();

      if (discardOnStopRef.current) {
        chunksRef.current = [];
        if (mountedRef.current && conversionGeneration === conversionGenerationRef.current) {
          setStatus('idle');
          setElapsedSeconds(0);
        }
        return;
      }

      const chunks = chunksRef.current;
      chunksRef.current = [];
      const capture = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      setStatus('converting');

      void convertRecordingToWav(capture)
        .then((wavFile) => {
          if (mountedRef.current && conversionGeneration === conversionGenerationRef.current) {
            onRecordingReady(wavFile);
            setStatus('ready');
          }
        })
        .catch(() => {
          if (mountedRef.current && conversionGeneration === conversionGenerationRef.current) {
            onDiscard();
            setStatus('idle');
            setElapsedSeconds(0);
            setError(
              'The recording could not be converted into a valid WAV. Record one utterance again or upload a WAV file.',
            );
          }
        });
    };

    try {
      recorder.start(250);
    } catch (startError) {
      releaseCaptureHardware();
      setStatus('idle');
      setError(microphoneErrorMessage(startError));
      return;
    }

    const startedAt = performance.now();
    setStatus('recording');
    intervalRef.current = setInterval(() => {
      setElapsedSeconds((performance.now() - startedAt) / 1_000);
    }, 100);
    limitRef.current = setTimeout(
      () => {
        discardOnStopRef.current = true;
        chunksRef.current = [];
        conversionGenerationRef.current += 1;
        if (recorder.state === 'recording') recorder.stop();
        if (mountedRef.current) {
          setStatus('idle');
          setElapsedSeconds(0);
          setError(
            `Recording exceeded the ${MAX_RECORDING_SECONDS}-second maximum. Record one shorter utterance and try again.`,
          );
        }
      },
      MAX_RECORDING_SECONDS * 1_000 + 100,
    );
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    clearRecordingTimers(intervalRef, limitRef);
    setStatus('converting');
    recorder.stop();
  }

  function discardRecording() {
    conversionGenerationRef.current += 1;
    discardOnStopRef.current = true;
    chunksRef.current = [];
    releaseCaptureHardware(true);
    onDiscard();
    setStatus('idle');
    setElapsedSeconds(0);
    setError('');
  }

  const elapsedLabel = `${Math.min(elapsedSeconds, MAX_RECORDING_SECONDS).toFixed(1)} seconds`;
  const announcedElapsedSeconds =
    Math.floor(Math.min(elapsedSeconds, MAX_RECORDING_SECONDS) / 5) * 5;
  const assistiveStatus =
    status === 'recording'
      ? `Recording. ${announcedElapsedSeconds} seconds elapsed.`
      : status === 'requesting'
        ? 'Waiting for microphone permission.'
        : status === 'converting'
          ? 'Converting the capture into WAV Source Audio.'
          : status === 'ready'
            ? `WAV Source Audio is ready after ${elapsedLabel}.`
            : 'Microphone is ready.';

  return (
    <div className="microphone-recorder">
      <div className="recorder-status">
        <span
          className={`recorder-indicator${status === 'recording' ? ' is-recording' : ''}`}
          aria-hidden="true"
        />
        <span>
          {status === 'idle' ? 'Microphone is ready when you are.' : null}
          {status === 'requesting' ? 'Waiting for microphone permission…' : null}
          {status === 'recording' ? `Recording — ${elapsedLabel} elapsed` : null}
          {status === 'converting' ? 'Converting the capture into private WAV Source Audio…' : null}
          {status === 'ready'
            ? `WAV Source Audio is ready (${elapsedLabel}). Only the converted WAV remains.`
            : null}
        </span>
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {assistiveStatus}
      </span>

      <div className="recorder-actions">
        {status === 'idle' ? (
          <button
            className="secondary-button"
            type="button"
            disabled={disabled}
            onClick={startRecording}
          >
            Grant access and record
          </button>
        ) : null}
        {status === 'recording' ? (
          <button className="primary-button" type="button" onClick={stopRecording}>
            Stop recording
          </button>
        ) : null}
        {status === 'ready' ? (
          <>
            <button
              className="secondary-button"
              type="button"
              disabled={disabled}
              onClick={startRecording}
            >
              Replace recording
            </button>
            <button
              className="text-button"
              type="button"
              disabled={disabled}
              onClick={discardRecording}
            >
              Discard recording
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="form-message" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function clearRecordingTimers(
  intervalRef: { current: ReturnType<typeof setInterval> | null },
  limitRef: { current: ReturnType<typeof setTimeout> | null },
): void {
  if (intervalRef.current) clearInterval(intervalRef.current);
  if (limitRef.current) clearTimeout(limitRef.current);
  intervalRef.current = null;
  limitRef.current = null;
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}
