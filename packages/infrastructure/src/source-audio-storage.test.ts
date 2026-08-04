import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createGcsSourceAudioStorage } from './source-audio-storage.js';

describe('private Source Audio storage port', () => {
  it('creates one short-lived operation-scoped upload URL and uses the GCS object boundary', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const storage = createGcsSourceAudioStorage({
      endpoint: 'http://gcs.test',
      bucket: 'source-audio',
      projectId: 'project-a',
      signingClientEmail: 'test-signer@example.test',
      signingPrivateKey: generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString(),
      autoCreateBucket: false,
      fetchImpl,
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const first = await storage.createUpload({
      objectKey: 'accounts/account-a/source-audio/upload.wav',
      expiresAt,
    });
    const second = await storage.createUpload({
      objectKey: 'accounts/account-a/source-audio/second.wav',
      expiresAt,
    });

    expect(first.uploadMethod).toBe('PUT');
    expect(first.uploadHeaders).toEqual({ 'content-type': 'audio/wav' });
    expect(first.uploadUrl).toContain('X-Goog-Algorithm=GOOG4-RSA-SHA256');
    expect(first.uploadUrl).toContain('X-Goog-Expires=');
    expect(first.uploadUrl).toContain('upload.wav');
    expect(second.uploadUrl).toContain('second.wav');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the emulator REST boundary for local direct uploads and object lifecycle', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/storage/v1/b?')) return new Response(null, { status: 200 });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.includes('alt=media')) return new Response(new Uint8Array([1, 2, 3]));
      return new Response(JSON.stringify({ contentType: 'audio/wav', size: '3' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const storage = createGcsSourceAudioStorage({
      endpoint: 'http://fake-gcs:4443',
      publicEndpoint: 'http://localhost:4443',
      bucket: 'source-audio',
      fetchImpl,
    });

    const upload = await storage.createUpload({
      objectKey: 'accounts/account-a/source-audio/upload.wav',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    expect(upload.uploadMethod).toBe('POST');
    expect(upload.uploadUrl).toMatch(/^http:\/\/localhost:4443\/upload\//);
    await expect(storage.stat('accounts/account-a/source-audio/upload.wav')).resolves.toEqual({
      contentType: 'audio/wav',
      size: 3,
    });
    await expect(storage.read('accounts/account-a/source-audio/upload.wav')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      storage.delete('accounts/account-a/source-audio/upload.wav'),
    ).resolves.toBeUndefined();
  });
});
