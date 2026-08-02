import { generateKeyPairSync } from 'node:crypto';

import { Storage } from '@google-cloud/storage';

import type { SourceAudioStorage } from '@damdai/application';

interface GcsObjectMetadata {
  contentType?: string;
  size?: string | number;
}

export interface GcsSourceAudioStorageOptions {
  endpoint: string;
  publicEndpoint?: string;
  bucket: string;
  projectId?: string;
  signingClientEmail?: string;
  signingPrivateKey?: string;
  autoCreateBucket?: boolean;
  fetchImpl?: typeof fetch;
}

export function createGcsSourceAudioStorage(
  options: GcsSourceAudioStorageOptions,
): SourceAudioStorage {
  const endpoint = options.endpoint.replace(/\/$/, '');
  const publicEndpoint = options.publicEndpoint?.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const storage = new Storage({
    projectId: options.projectId,
    apiEndpoint: endpoint,
    useAuthWithCustomEndpoint: false,
    credentials: createSigningCredentials(options),
  });
  let bucketReady: Promise<void> | undefined;

  return {
    async createUpload({ objectKey, expiresAt }) {
      if (options.autoCreateBucket ?? true) {
        bucketReady ??= ensureBucket(endpoint, options.bucket, options.projectId, fetchImpl);
        await bucketReady;
      }

      if (isFakeGcsEndpoint(endpoint)) {
        // fake-gcs-server does not validate V4 signatures or expiry. The upload session
        // and finalization path still enforce ownership and expiry; real GCS uses the
        // signed branch below before staging acceptance.
        const url = new URL(
          `${publicEndpoint ?? endpoint}/upload/storage/v1/b/${encodeURIComponent(options.bucket)}/o`,
        );
        url.searchParams.set('uploadType', 'media');
        url.searchParams.set('name', objectKey);
        url.searchParams.set('contentType', 'audio/wav');
        url.searchParams.set('x-damdai-expires', String(expiresAt.getTime()));

        return {
          uploadUrl: url.toString(),
          uploadMethod: 'POST' as const,
          uploadHeaders: { 'content-type': 'audio/wav' as const },
        };
      }

      const [uploadUrl] = await storage.bucket(options.bucket).file(objectKey).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAt,
        contentType: 'audio/wav',
      });

      return {
        uploadUrl,
        uploadMethod: 'PUT' as const,
        uploadHeaders: { 'content-type': 'audio/wav' as const },
      };
    },

    async stat(objectKey) {
      const response = await fetchImpl(objectUrl(endpoint, options.bucket, objectKey));
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`Source Audio metadata request failed (${response.status})`);

      const metadata = (await response.json()) as GcsObjectMetadata;
      return {
        contentType: metadata.contentType ?? 'application/octet-stream',
        size: Number(metadata.size ?? 0),
      };
    },

    async read(objectKey) {
      const response = await fetchImpl(downloadUrl(endpoint, options.bucket, objectKey));
      if (!response.ok) throw new Error(`Source Audio read failed (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async delete(objectKey) {
      const response = await fetchImpl(objectUrl(endpoint, options.bucket, objectKey), {
        method: 'DELETE',
      });
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`Source Audio deletion failed (${response.status})`);
    },
  };
}

function isFakeGcsEndpoint(endpoint: string): boolean {
  return endpoint.includes('localhost:4443') || endpoint.includes('fake-gcs');
}

function createSigningCredentials(options: GcsSourceAudioStorageOptions) {
  if (options.signingClientEmail && options.signingPrivateKey) {
    return {
      client_email: options.signingClientEmail,
      private_key: options.signingPrivateKey,
    };
  }

  if (!isFakeGcsEndpoint(options.endpoint)) {
    throw new Error('GCS signing credentials are required outside the local fake-GCS endpoint');
  }

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    client_email: 'local-signer@damdai.local',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

async function ensureBucket(
  endpoint: string,
  bucket: string,
  projectId: string | undefined,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = new URL(`${endpoint}/storage/v1/b`);
  if (projectId) url.searchParams.set('project', projectId);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: bucket }),
  });

  if (!response.ok && response.status !== 409) {
    throw new Error(`Source Audio bucket is unavailable (${response.status})`);
  }
}

function objectUrl(endpoint: string, bucket: string, objectKey: string): string {
  return `${endpoint}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectKey)}`;
}

function downloadUrl(endpoint: string, bucket: string, objectKey: string): string {
  return `${endpoint}/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectKey)}?alt=media`;
}
