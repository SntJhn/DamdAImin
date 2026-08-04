import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createPrivacySafeLogger } from './logging.js';

describe('runtime Pino privacy redaction', () => {
  it('does not emit submitted or derived content through the logger', () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const logger = createPrivacySafeLogger({ name: 'redaction-test' }, destination);
    const runtimeError = new Error('SENTINEL_ERROR_MESSAGE');

    logger.info(
      {
        analysisId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
        audioBase64: 'SENTINEL_AUDIO',
        transcript: 'SENTINEL_TRANSCRIPT',
        explanation: 'SENTINEL_EXPLANATION',
        technicalTrace: 'SENTINEL_TRACE',
        signedUrl: 'SENTINEL_SIGNED_URL',
        token: 'SENTINEL_TOKEN',
        password: 'SENTINEL_PASSWORD',
        email: 'SENTINEL_EMAIL',
        req: {
          headers: {
            authorization: 'SENTINEL_AUTHORIZATION',
            cookie: 'SENTINEL_COOKIE',
          },
        },
        err: { message: 'SENTINEL_ERROR_MESSAGE' },
        result: {
          transcript: 'SENTINEL_RESULT_TRANSCRIPT',
          explanation: 'SENTINEL_RESULT_EXPLANATION',
          technicalTrace: 'SENTINEL_RESULT_TRACE',
        },
      },
      'analysis runtime log',
    );
    logger.error(runtimeError, 'analysis runtime error');

    const output = chunks.join('');
    expect(output).toContain('8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01');
    for (const sentinel of [
      'SENTINEL_AUDIO',
      'SENTINEL_TRANSCRIPT',
      'SENTINEL_EXPLANATION',
      'SENTINEL_TRACE',
      'SENTINEL_SIGNED_URL',
      'SENTINEL_TOKEN',
      'SENTINEL_PASSWORD',
      'SENTINEL_EMAIL',
      'SENTINEL_AUTHORIZATION',
      'SENTINEL_COOKIE',
      'SENTINEL_ERROR_MESSAGE',
      'SENTINEL_RESULT_TRANSCRIPT',
      'SENTINEL_RESULT_EXPLANATION',
      'SENTINEL_RESULT_TRACE',
    ]) {
      expect(output).not.toContain(sentinel);
    }
  });
});
