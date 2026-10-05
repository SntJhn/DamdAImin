import { describe, expect, it, vi } from 'vitest';

import { inspectWavAudio } from '@damdai/domain';

import {
  convertRecordingToWav,
  encodePcm16Wav,
  microphoneErrorMessage,
  validateRecordingDuration,
} from './recording-audio.js';

describe('browser microphone WAV conversion', () => {
  it('encodes decoded mono samples as contract-compatible 16-bit PCM WAV', () => {
    const wav = encodePcm16Wav({
      sampleRate: 16_000,
      channels: [new Float32Array([0, 0.5, -0.5, 1, -1])],
    });

    expect(inspectWavAudio(wav)).toMatchObject({
      channels: 1,
      sampleRateHz: 16_000,
      bitsPerSample: 16,
      dataByteLength: 10,
    });
    const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, 5);
    expect(Array.from(samples)).toEqual([0, 16_383, -16_384, 32_767, -32_768]);
  });

  it('interleaves every decoded channel without retaining the encoded capture format', () => {
    const wav = encodePcm16Wav({
      sampleRate: 48_000,
      channels: [new Float32Array([0.25, 0.5]), new Float32Array([-0.25, -0.5])],
    });

    expect(inspectWavAudio(wav)).toMatchObject({
      channels: 2,
      sampleRateHz: 48_000,
      bitsPerSample: 16,
      dataByteLength: 8,
    });
    const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, 4);
    expect(Array.from(samples)).toEqual([8_191, -8_192, 16_383, -16_384]);
  });

  it('rejects empty, inconsistent, and over-limit decoded captures before upload creation', () => {
    expect(() => encodePcm16Wav({ sampleRate: 16_000, channels: [] })).toThrow(
      'decoded into no audio channels',
    );
    expect(() =>
      encodePcm16Wav({
        sampleRate: 16_000,
        channels: [new Float32Array(2), new Float32Array(3)],
      }),
    ).toThrow('inconsistent audio channels');
    expect(() => validateRecordingDuration(60.01)).toThrow('60-second maximum');
    expect(() => validateRecordingDuration(0)).not.toThrow();
  });

  it('converts decoded capture data into a WAV File and releases its decoder', async () => {
    const close = vi.fn(async () => undefined);
    const file = await convertRecordingToWav(new Blob(['synthetic encoded capture']), () => ({
      close,
      decodeAudioData: async () => ({
        length: 4,
        numberOfChannels: 1,
        sampleRate: 16_000,
        getChannelData: () => new Float32Array([0, 0.25, -0.25, 0]),
      }),
    }));

    expect(file.name).toBe('speech-sample.wav');
    expect(file.type).toBe('audio/wav');
    expect(inspectWavAudio(new Uint8Array(await file.arrayBuffer()))).toMatchObject({
      channels: 1,
      sampleRateHz: 16_000,
      bitsPerSample: 16,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects a decoded capture that contains no audible microphone signal', async () => {
    const close = vi.fn(async () => undefined);

    await expect(
      convertRecordingToWav(new Blob(['synthetic encoded capture']), () => ({
        close,
        decodeAudioData: async () => ({
          length: 16_000,
          numberOfChannels: 1,
          sampleRate: 16_000,
          getChannelData: () => new Float32Array(16_000),
        }),
      })),
    ).rejects.toThrow('No audible speech signal was detected');
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps a quiet but nonzero capture for the Research System to evaluate', async () => {
    const close = vi.fn(async () => undefined);
    const quietSamples = Float32Array.from(
      { length: 16_000 },
      (_, index) => Math.sin((index / 16_000) * Math.PI * 2 * 220) * 0.0005,
    );

    await expect(
      convertRecordingToWav(new Blob(['synthetic encoded capture']), () => ({
        close,
        decodeAudioData: async () => ({
          length: quietSamples.length,
          numberOfChannels: 1,
          sampleRate: 16_000,
          getChannelData: () => quietSamples,
        }),
      })),
    ).resolves.toBeInstanceOf(File);
    expect(close).toHaveBeenCalledOnce();
  });

  it('releases its decoder when browser conversion fails', async () => {
    const close = vi.fn(async () => undefined);

    await expect(
      convertRecordingToWav(new Blob(['synthetic encoded capture']), () => ({
        close,
        decodeAudioData: async () => {
          throw new DOMException('Synthetic decode failure', 'EncodingError');
        },
      })),
    ).rejects.toThrow('Synthetic decode failure');
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('microphone recovery messages', () => {
  it.each([
    ['NotAllowedError', 'Microphone permission was denied'],
    ['NotFoundError', 'No microphone is available'],
    ['NotReadableError', 'The microphone is unavailable'],
    ['SecurityError', 'Microphone access is unavailable in this browser context'],
  ])('maps %s into an accessible recovery message', (name, expected) => {
    expect(microphoneErrorMessage(new DOMException('', name))).toContain(expected);
  });

  it('uses a safe conversion message without exposing browser internals', () => {
    expect(microphoneErrorMessage(new Error('SENTINEL_BROWSER_DETAIL'))).toBe(
      'The microphone could not start. Check that it is connected and not in use, then try again.',
    );
  });
});
