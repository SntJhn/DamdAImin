import { inspectWavAudio } from '@damdai/domain';

export const MAX_RECORDING_SECONDS = 20;
// Keep this guard below the Research System's speech/VAD decision. It only
// rejects numerically silent captures; quiet speech must still reach ASR.
const MIN_RECORDING_PEAK = 0.0001;
const MIN_RECORDING_RMS = 0.00001;

export class InaudibleRecordingError extends Error {
  constructor() {
    super(
      'No audible speech signal was detected. Check the live waveform, move closer to the microphone, and record again.',
    );
    this.name = 'InaudibleRecordingError';
  }
}

interface DecodedAudio {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

interface AudioDecoder {
  decodeAudioData(audioData: ArrayBuffer): Promise<DecodedAudio>;
  close(): Promise<void>;
}

interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export function validateRecordingDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error('The recording duration is invalid.');
  }

  if (durationSeconds > MAX_RECORDING_SECONDS) {
    throw new Error(`The recording exceeds the ${MAX_RECORDING_SECONDS}-second maximum.`);
  }
}

export function encodePcm16Wav(audio: PcmAudio): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate <= 0) {
    throw new Error('The recording decoded with an invalid sample rate.');
  }

  if (audio.channels.length === 0) {
    throw new Error('The recording decoded into no audio channels.');
  }

  const frameCount = audio.channels[0]?.length ?? 0;
  if (frameCount === 0) {
    throw new Error('The recording decoded into no audio data.');
  }

  if (audio.channels.some((channel) => channel.length !== frameCount)) {
    throw new Error('The recording decoded into inconsistent audio channels.');
  }

  validateRecordingDuration(frameCount / audio.sampleRate);

  const channelCount = audio.channels.length;
  const bytesPerSample = 2;
  const dataByteLength = frameCount * channelCount * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, wavBuffer.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  let byteOffset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (const channel of audio.channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      view.setInt16(byteOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      byteOffset += bytesPerSample;
    }
  }

  return new Uint8Array(wavBuffer);
}

export function validateRecordingSignal(channels: readonly Float32Array[]): void {
  let sampleCount = 0;
  let sampleSum = 0;

  for (const channel of channels) {
    sampleCount += channel.length;
    for (const sample of channel) sampleSum += sample;
  }

  if (sampleCount === 0) throw new InaudibleRecordingError();

  const mean = sampleSum / sampleCount;
  let centeredSquareSum = 0;
  let centeredPeak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const centered = sample - mean;
      centeredSquareSum += centered * centered;
      centeredPeak = Math.max(centeredPeak, Math.abs(centered));
    }
  }

  const rms = Math.sqrt(centeredSquareSum / sampleCount);
  if (centeredPeak < MIN_RECORDING_PEAK || rms < MIN_RECORDING_RMS) {
    throw new InaudibleRecordingError();
  }
}

export async function convertRecordingToWav(
  capture: Blob,
  createDecoder: () => AudioDecoder = createBrowserAudioDecoder,
): Promise<File> {
  if (capture.size === 0) {
    throw new Error('The microphone capture contained no audio data.');
  }

  const decoder = createDecoder();
  try {
    const decoded = await decoder.decodeAudioData(await capture.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
      decoded.getChannelData(channel).slice(),
    );
    validateRecordingSignal(channels);
    const wav = encodePcm16Wav({ sampleRate: decoded.sampleRate, channels });

    // Guard the browser conversion at the same structural seam used by the API
    // before any private upload operation or Analysis is created.
    inspectWavAudio(wav, MAX_RECORDING_SECONDS);

    return new File([wav.buffer], 'speech-sample.wav', {
      type: 'audio/wav',
      lastModified: Date.now(),
    });
  } finally {
    await decoder.close();
  }
}

export function microphoneErrorMessage(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone permission was denied. Allow microphone access in your browser settings, then try again.';
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone is available. Connect or enable one, then try again.';
  }

  if (
    name === 'NotReadableError' ||
    name === 'TrackStartError' ||
    name === 'OverconstrainedError'
  ) {
    return 'The microphone is unavailable. Close other apps using it or choose another device, then try again.';
  }

  if (name === 'SecurityError') {
    return 'Microphone access is unavailable in this browser context. Use a secure connection and allow microphone access.';
  }

  return 'The microphone could not start. Check that it is connected and not in use, then try again.';
}

function createBrowserAudioDecoder(): AudioDecoder {
  return new AudioContext();
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (const [index, character] of Array.from(value).entries()) {
    view.setUint8(offset + index, character.charCodeAt(0));
  }
}
