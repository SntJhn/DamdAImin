import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export const privacyRedactionPaths = [
  'audio',
  'audioBase64',
  'transcript',
  'explanation',
  'technicalTrace',
  'signedUrl',
  'uploadUrl',
  'token',
  'authorization',
  'cookie',
  'password',
  'email',
  'result',
  'analysis.result',
  'confidence',
  'probabilities',
  'err.message',
  'err.stack',
  'error.message',
  'error.stack',
  'result.transcript',
  'result.explanation',
  'result.technicalTrace',
] as const;

export function createPrivacySafeLogger(
  options: Omit<LoggerOptions, 'redact'> = {},
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      ...options,
      serializers: {
        ...options.serializers,
        req: serializeSafeRequest,
      },
      redact: {
        paths: [...privacyRedactionPaths],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

function serializeSafeRequest(request: unknown): Record<string, unknown> {
  if (!request || typeof request !== 'object') return {};

  const candidate = request as Record<string, unknown>;
  return {
    method: candidate.method,
    host: candidate.hostname ?? candidate.host,
    remoteAddress: candidate.ip ?? candidate.remoteAddress,
  };
}
