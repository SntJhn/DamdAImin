import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AuthenticatedAccount {
  accountId: string;
}

export interface AuthVerifier {
  verify(token: string): Promise<AuthenticatedAccount>;
}

export interface AuthClaimValidationOptions {
  issuer: string;
  audience: string;
}

export interface NeonAuthVerifierOptions extends AuthClaimValidationOptions {
  jwksUrl: string;
}

export class AuthVerificationError extends Error {
  constructor(message = 'invalid bearer token') {
    super(message);
    this.name = 'AuthVerificationError';
  }
}

export function validateAuthClaims(
  claims: JWTPayload,
  options: AuthClaimValidationOptions,
): AuthenticatedAccount {
  if (claims.iss !== options.issuer) {
    throw new AuthVerificationError('token issuer is not trusted');
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) {
    throw new AuthVerificationError('token audience is not trusted');
  }

  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new AuthVerificationError('token is expired');
  }

  const accountId = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!accountId) {
    throw new AuthVerificationError('token subject is required');
  }

  const emailVerified = claims.email_verified ?? claims.emailVerified;
  if (emailVerified !== true) {
    throw new AuthVerificationError('verified account is required');
  }

  return { accountId };
}

export function createNeonAuthTokenVerifier(options: NeonAuthVerifierOptions): AuthVerifier {
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl));

  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          algorithms: ['EdDSA'],
          issuer: options.issuer,
          audience: options.audience,
        });

        return validateAuthClaims(payload, options);
      } catch (error) {
        if (error instanceof AuthVerificationError) {
          throw error;
        }

        throw new AuthVerificationError();
      }
    },
  };
}
