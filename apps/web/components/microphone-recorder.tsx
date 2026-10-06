'use client';

import { useEffect, useRef, useState } from 'react';

import {
  convertRecordingToWav,
  InaudibleRecordingError,
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
  const [signalDetected, setSignalDetected] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silentOutputNodeRef = useRef<GainNode | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const signalDetectedRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardOnStopRef = useRef(false);
  const conversionGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  function releaseCaptureHardware(stopRecorder = false) {
    clearRecordingTimers(intervalRef, limitRef);
    stopSignalMonitor();
    const recorder = recorderRef.current;
    if (stopRecorder && recorder?.state === 'recording') recorder.stop();
    stopStream(streamRef.current);
    recorderRef.current = null;
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    drawWaveform(waveformCanvasRef.current, null);
    const redrawWaveform = () => {
      drawWaveform(waveformCanvasRef.current, waveformDataRef.current);
    };
    window.addEventListener('resize', redrawWaveform);
    return () => {
      window.removeEventListener('resize', redrawWaveform);
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
    setSignalDetected(false);
    signalDetectedRef.current = false;
    waveformDataRef.current = null;
    drawWaveform(waveformCanvasRef.current, null);
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
          autoGainControl: true,
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
    startSignalMonitor(stream);

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
        .catch((conversionError: unknown) => {
          if (mountedRef.current && conversionGeneration === conversionGenerationRef.current) {
            onDiscard();
            setStatus('idle');
            setElapsedSeconds(0);
            setSignalDetected(false);
            waveformDataRef.current = null;
            drawWaveform(waveformCanvasRef.current, null);
            setError(
              conversionError instanceof InaudibleRecordingError
                ? conversionError.message
                : 'The recording could not be converted into a valid WAV. Record one utterance again or upload a WAV file.',
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
    setSignalDetected(false);
    signalDetectedRef.current = false;
    waveformDataRef.current = null;
    drawWaveform(waveformCanvasRef.current, null);
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
      <div
        className={`recorder-waveform${status === 'recording' ? ' is-recording' : ''}`}
        data-signal-detected={signalDetected ? 'true' : 'false'}
      >
        <canvas
          ref={waveformCanvasRef}
          className="recorder-waveform-canvas"
          role="img"
          aria-label="Live microphone waveform"
        />
        <span className="recorder-waveform-label" aria-hidden="true">
          {status === 'recording'
            ? signalDetected
              ? 'Voice signal detected'
              : 'Listening for your voice'
            : status === 'ready'
              ? 'Captured waveform'
              : 'Live microphone input'}
        </span>
      </div>
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
            Record Audio
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

  function startSignalMonitor(stream: MediaStream) {
    try {
      const audioContext = new AudioContext();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2_048;
      analyser.smoothingTimeConstant = 0.72;
      const silentOutput = audioContext.createGain();
      silentOutput.gain.value = 0;
      sourceNode.connect(analyser);
      analyser.connect(silentOutput);
      silentOutput.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      analyserRef.current = analyser;
      silentOutputNodeRef.current = silentOutput;
      const samples = new Float32Array(analyser.fftSize);

      const renderFrame = () => {
        if (analyserRef.current !== analyser) return;
        analyser.getFloatTimeDomainData(samples);
        waveformDataRef.current = samples.slice();
        drawWaveform(waveformCanvasRef.current, samples);

        if (!signalDetectedRef.current && hasLiveSignal(samples)) {
          signalDetectedRef.current = true;
          if (mountedRef.current) setSignalDetected(true);
        }

        waveformFrameRef.current = requestAnimationFrame(renderFrame);
      };

      void audioContext.resume().catch(() => undefined);
      renderFrame();
    } catch {
      stopSignalMonitor();
      drawWaveform(waveformCanvasRef.current, null);
    }
  }

  function stopSignalMonitor() {
    if (waveformFrameRef.current !== null) cancelAnimationFrame(waveformFrameRef.current);
    waveformFrameRef.current = null;
    sourceNodeRef.current?.disconnect();
    analyserRef.current?.disconnect();
    silentOutputNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    analyserRef.current = null;
    silentOutputNodeRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => undefined);
    }
  }
}

function hasLiveSignal(samples: Float32Array): boolean {
  let squareSum = 0;
  for (const sample of samples) {
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / samples.length) >= 0.0001;
}

function drawWaveform(
  canvas: HTMLCanvasElement | null,
  samples: Float32Array<ArrayBuffer> | null,
): void {
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(Math.round(bounds.width), 1);
  const height = Math.max(Math.round(bounds.height), 1);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const renderWidth = Math.round(width * pixelRatio);
  const renderHeight = Math.round(height * pixelRatio);
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const middle = height / 2;
  context.beginPath();
  context.moveTo(0, middle);
  context.lineTo(width, middle);
  context.strokeStyle = 'rgba(117, 117, 117, 0.2)';
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  if (!samples?.length) {
    context.moveTo(0, middle);
    context.lineTo(width, middle);
  } else {
    const horizontalStep = width / Math.max(samples.length - 1, 1);
    for (let index = 0; index < samples.length; index += 1) {
      const normalized = samples[index] ?? 0;
      const x = index * horizontalStep;
      const y = middle + normalized * height * 0.42;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#fd5113');
  gradient.addColorStop(0.52, '#ff8b1f');
  gradient.addColorStop(1, '#f3b61f');
  context.strokeStyle = gradient;
  context.lineWidth = 2.2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
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
