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
  'req.headers.authorization',
  'req.headers.cookie',
  'err.message',
  'error.message',
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
      redact: {
        paths: [...privacyRedactionPaths],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}
