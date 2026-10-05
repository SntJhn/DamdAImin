import { describe, expect, it } from 'vitest';

import { InvalidWavError, inspectWavAudio } from './analysis.js';

function createPcmWav(durationSeconds: number, sampleRateHz = 16_000): Uint8Array {
  const channels = 1;
  const bitsPerSample = 16;
  const dataByteLength = sampleRateHz * durationSeconds * channels * (bitsPerSample / 8);
  const bytes = new Uint8Array(44 + dataByteLength);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (const [index, character] of Array.from(value).entries()) {
    view.setUint8(offset + index, character.charCodeAt(0));
  }
}

describe('WAV input boundary', () => {
  it('accepts a structurally valid PCM WAV and reports its duration', () => {
    expect(inspectWavAudio(createPcmWav(2))).toMatchObject({
      byteLength: 64_044,
      dataByteLength: 64_000,
      durationSeconds: 2,
      channels: 1,
      sampleRateHz: 16_000,
      bitsPerSample: 16,
    });
  });

  it('rejects malformed WAV data', () => {
    expect(() => inspectWavAudio(new Uint8Array(44))).toThrow(InvalidWavError);
    expect(() => inspectWavAudio(new TextEncoder().encode('not audio'))).toThrow(
      'WAV data is too short',
    );
  });

  it('rejects audio over the 60-second maximum', () => {
    expect(() => inspectWavAudio(createPcmWav(61))).toThrow('60-second maximum');
  });
});
