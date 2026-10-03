export const analysisStatuses = [
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
] as const;

export type AnalysisStatus = (typeof analysisStatuses)[number];

export const analysisLanguages = ['taglish', 'english', 'tagalog'] as const;

export type AnalysisLanguage = (typeof analysisLanguages)[number];

export const emotionClassifications = ['happiness', 'sadness', 'anger', 'neutrality'] as const;

export type EmotionClassification = (typeof emotionClassifications)[number];

export const analysisOutcomes = ['definitive', 'inconclusive'] as const;

export type AnalysisOutcome = (typeof analysisOutcomes)[number];

export interface ConfidenceBreakdown {
  happiness: number;
  sadness: number;
  anger: number;
  neutrality: number;
}

export type TechnicalCueSource = 'acoustic' | 'linguistic';

export interface TechnicalCueSpan {
  source: TechnicalCueSource;
  startMs: number;
  endMs: number;
  cue: string;
  value: string;
}

export interface ActivatedRule {
  id: string;
  description: string;
}

export interface ScoreAdjustment {
  emotionClassification: EmotionClassification;
  delta: number;
  reason: string;
}

export interface TechnicalTrace {
  cueSpans: TechnicalCueSpan[];
  activatedRules: ActivatedRule[];
  scoreAdjustments: ScoreAdjustment[];
  probabilities: {
    before: ConfidenceBreakdown;
    symbolic?: ConfidenceBreakdown;
    after: ConfidenceBreakdown;
  };
}

interface AnalysisResultFields {
  confidence: ConfidenceBreakdown;
  transcript: string;
  explanation: string;
  technicalTrace: TechnicalTrace;
  contractVersion: string;
  schemaVersion: string;
  modelVersion: string;
  preprocessingVersion: string;
  ruleSetVersion: string;
}

export type AnalysisResult =
  | (AnalysisResultFields & {
      outcome: 'definitive';
      emotionClassification: EmotionClassification;
    })
  | (AnalysisResultFields & {
      outcome: 'inconclusive';
    });

export interface WavInspection {
  byteLength: number;
  dataByteLength: number;
  durationSeconds: number;
  channels: number;
  sampleRateHz: number;
  bitsPerSample: number;
}

export class InvalidWavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWavError';
  }
}

export function inspectWavAudio(bytes: Uint8Array, maximumDurationSeconds = 20): WavInspection {
  if (bytes.byteLength < 44) {
    throw new InvalidWavError('WAV data is too short');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new InvalidWavError('WAV must use a RIFF/WAVE container');
  }

  let format: {
    audioFormat: number;
    channels: number;
    sampleRateHz: number;
    bitsPerSample: number;
  } | null = null;
  let dataByteLength = 0;
  let offset = 12;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkEnd > view.byteLength) {
      throw new InvalidWavError('WAV chunk extends beyond the file');
    }

    if (chunkId === 'fmt ') {
      if (chunkLength < 16) {
        throw new InvalidWavError('WAV format chunk is incomplete');
      }

      format = {
        audioFormat: view.getUint16(chunkStart, true),
        channels: view.getUint16(chunkStart + 2, true),
        sampleRateHz: view.getUint32(chunkStart + 4, true),
        bitsPerSample: view.getUint16(chunkStart + 14, true),
      };
    }

    if (chunkId === 'data') {
      dataByteLength = chunkLength;
    }

    offset = chunkEnd + (chunkLength % 2);
  }

  if (!format || dataByteLength === 0) {
    throw new InvalidWavError('WAV must contain format and audio data chunks');
  }

  if (format.audioFormat !== 1) {
    throw new InvalidWavError('WAV must contain uncompressed PCM audio');
  }

  if (
    format.channels < 1 ||
    format.sampleRateHz < 1 ||
    ![8, 16, 24, 32].includes(format.bitsPerSample)
  ) {
    throw new InvalidWavError('WAV format values are unsupported');
  }

  const bytesPerSample = format.bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * format.channels;
  if (dataByteLength % bytesPerFrame !== 0) {
    throw new InvalidWavError('WAV audio data is not aligned to complete frames');
  }

  const durationSeconds = dataByteLength / bytesPerFrame / format.sampleRateHz;
  if (durationSeconds > maximumDurationSeconds) {
    throw new InvalidWavError(`WAV exceeds the ${maximumDurationSeconds}-second maximum`);
  }

  return {
    byteLength: bytes.byteLength,
    dataByteLength,
    durationSeconds,
    channels: format.channels,
    sampleRateHz: format.sampleRateHz,
    bitsPerSample: format.bitsPerSample,
  };
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );
}

export interface AnalysisSummary {
  id: string;
  accountId: string;
  status: AnalysisStatus;
  language: AnalysisLanguage;
  createdAt: Date;
  result: AnalysisHistoryResult | null;
}

export type AnalysisHistoryResult =
  | {
      outcome: 'definitive';
      emotionClassification: EmotionClassification;
      transcript: string;
    }
  | {
      outcome: 'inconclusive';
      transcript: string;
    };

export function toAnalysisHistoryResult(result: AnalysisResult): AnalysisHistoryResult {
  return result.outcome === 'definitive'
    ? {
        outcome: 'definitive',
        emotionClassification: result.emotionClassification,
        transcript: result.transcript,
      }
    : {
        outcome: 'inconclusive',
        transcript: result.transcript,
      };
}
