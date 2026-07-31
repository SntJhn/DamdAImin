import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { createNeonAuthTokenVerifier, validateAuthClaims } from './auth.js';

describe('Neon Auth claims', () => {
  const options = {
    issuer: 'https://auth.example.test',
    audience: 'https://auth.example.test',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies the bearer signature with the configured JWKS', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA');
    const jwk = await exportJWK(publicKey);
    const keyId = 'test-key';
    const token = await new SignJWT({ email_verified: true })
      .setProtectedHeader({ alg: 'EdDSA', kid: keyId })
      .setIssuer(options.issuer)
      .setAudience(options.audience)
      .setSubject('8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01')
      .setExpirationTime('1h')
      .sign(privateKey);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ keys: [{ ...jwk, alg: 'EdDSA', kid: keyId, use: 'sig' }] }),
            {
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );

    const verifier = createNeonAuthTokenVerifier({
      ...options,
      jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      accountId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
    });
  });

  it('accepts a signed-token payload for a verified account', () => {
    expect(
      validateAuthClaims(
        {
          sub: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          iss: options.issuer,
          aud: options.audience,
          exp: Math.floor(Date.now() / 1000) + 60,
          email_verified: true,
        },
        options,
      ),
    ).toEqual({ accountId: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01' });
  });

  it('rejects an account that has not verified its email', () => {
    expect(() =>
      validateAuthClaims(
        {
          sub: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
          iss: options.issuer,
          aud: options.audience,
          exp: Math.floor(Date.now() / 1000) + 60,
          email_verified: false,
        },
        options,
      ),
    ).toThrow('verified account is required');
  });

  it('rejects a token with the wrong issuer, audience, or expiration', () => {
    const baseClaims = {
      sub: '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01',
      iss: options.issuer,
      aud: options.audience,
      exp: Math.floor(Date.now() / 1000) + 60,
      email_verified: true,
    };

    expect(() => validateAuthClaims({ ...baseClaims, iss: 'https://other.test' }, options)).toThrow(
      'issuer',
    );
    expect(() => validateAuthClaims({ ...baseClaims, aud: 'https://other.test' }, options)).toThrow(
      'audience',
    );
    expect(() =>
      validateAuthClaims({ ...baseClaims, exp: Math.floor(Date.now() / 1000) - 1 }, options),
    ).toThrow('expired');
  });
});
