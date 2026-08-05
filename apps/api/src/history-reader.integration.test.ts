import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAnalysisServices,
  type AnalysisJob,
  type AnalysisTelemetryEvent,
  type AnalysisServices,
} from '@damdai/application';
import type { AnalysisResult } from '@damdai/application';
import {
  analyses,
  createAnalysisRepository,
  createAnalysisHistoryReader,
  createDatabase,
  migrateDatabase,
} from '@damdai/database';
import {
  createAnalysisQueue,
  createAnalysisWorker,
  createGcsSourceAudioStorage,
  createPrivacySafeLogger,
  createResearchSystemClient,
} from '@damdai/infrastructure';
import { buildResearchFake } from '@damdai/research-fake';

import { buildApi } from './app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRedisUrl = process.env.TEST_REDIS_URL;
const testGcsEndpoint = process.env.TEST_GCS_ENDPOINT;

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required; run pnpm test:integration');
}
if (!testGcsEndpoint) {
  throw new Error('TEST_GCS_ENDPOINT is required; run pnpm test:integration');
}
if (!testRedisUrl) {
  throw new Error('TEST_REDIS_URL is required; run pnpm test:integration');
}

interface DatabaseSchemaObject {
  objectKind: string;
  objectIdentity: string;
  definition: string;
}

interface DatabaseSchemaState {
  exists: boolean;
  objects: readonly DatabaseSchemaObject[];
}

const database = createDatabase(testDatabaseUrl);
const accountA = randomUUID();
const accountB = randomUUID();
const accountAActive = randomUUID();
const accountACanceled = randomUUID();
const accountBActive = randomUUID();
const accountACompleted = randomUUID();
const accountAInconclusive = randomUUID();
const accountAFailed = randomUUID();
const accountAProcessing = randomUUID();
const accountATieFirst = randomUUID();
const accountATieSecond = randomUUID();
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/database/drizzle',
);
const neonAuthSentinel = 'migration must not change this row';
let neonAuthBeforeMigration: DatabaseSchemaState;
let analysisApplication: ReturnType<typeof buildApi> | undefined;
let analysisServices: AnalysisServices | undefined;
let integrationQueue: ReturnType<typeof createAnalysisQueue> | undefined;
let integrationWorker: ReturnType<typeof createAnalysisWorker> | undefined;
let integrationStorage: ReturnType<typeof createGcsSourceAudioStorage> | undefined;
let researchFake: ReturnType<typeof buildResearchFake> | undefined;
let researchFakeUrl = '';
let integrationUploadId = '';
let integrationObjectKey = '';
const integrationJobs: AnalysisJob[] = [];
const integrationTelemetryEvents: AnalysisTelemetryEvent[] = [];
const integrationLogChunks: string[] = [];
const integrationLogDestination = new Writable({
  write(chunk, _encoding, callback) {
    integrationLogChunks.push(String(chunk));
    callback();
  },
});
const integrationLogger = createPrivacySafeLogger(
  { name: 'history-integration' },
  integrationLogDestination,
);
const integrationTelemetry = {
  record(event: AnalysisTelemetryEvent) {
    integrationTelemetryEvents.push(event);
  },
};

const historyDefinitiveResult: AnalysisResult = {
  outcome: 'definitive',
  emotionClassification: 'happiness',
  confidence: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
  transcript: 'Masaya ako sa araw na ito.',
  explanation: 'History fixture explanation.',
  technicalTrace: {
    cueSpans: [],
    activatedRules: [],
    scoreAdjustments: [],
    probabilities: {
      before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
      after: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
    },
  },
  contractVersion: 'taglish-v2',
  schemaVersion: 'research-response-v2',
  modelVersion: 'history-fixture-model',
  preprocessingVersion: 'history-fixture-preprocessing',
  ruleSetVersion: 'history-fixture-rules',
};

const historyInconclusiveResult: AnalysisResult = {
  outcome: 'inconclusive',
  confidence: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
  transcript: 'Hindi malinaw ang sample.',
  explanation: 'History fixture explanation.',
  technicalTrace: {
    cueSpans: [],
    activatedRules: [],
    scoreAdjustments: [],
    probabilities: {
      before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
      after: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
    },
  },
  contractVersion: 'english-v2',
  schemaVersion: 'research-response-v2',
  modelVersion: 'history-fixture-model',
  preprocessingVersion: 'history-fixture-preprocessing',
  ruleSetVersion: 'history-fixture-rules',
};

function createPcmWav(durationSeconds: number): Uint8Array {
  const sampleRateHz = 16_000;
  const dataByteLength = sampleRateHz * durationSeconds * 2;
  const bytes = new Uint8Array(44 + dataByteLength);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (const [index, character] of Array.from(value).entries()) {
      view.setUint8(offset + index, character.charCodeAt(0));
    }
  };

  write(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataByteLength, true);
  return bytes;
}

async function readSchemaState(schemaName: string): Promise<DatabaseSchemaState> {
  const metadata = await database.pool.query<DatabaseSchemaObject>(
    `
      WITH schema_metadata AS (
        SELECT
          'schema' AS "objectKind",
          n.oid::text AS "objectIdentity",
          jsonb_build_object(
            'name', n.nspname,
            'owner', pg_get_userbyid(n.nspowner),
            'acl', COALESCE(n.nspacl::text, '')
          )::text AS definition
        FROM pg_namespace AS n
        WHERE n.nspname = $1
      ), relation_metadata AS (
        SELECT
          'relation' AS "objectKind",
          c.oid::text AS "objectIdentity",
          jsonb_build_object(
            'name', c.relname,
            'kind', c.relkind::text,
            'owner', pg_get_userbyid(c.relowner),
            'acl', COALESCE(c.relacl::text, ''),
            'options', COALESCE(array_to_string(c.reloptions, ','), ''),
            'definition', CASE
              WHEN c.relkind = 'i' THEN pg_get_indexdef(c.oid)
              WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true)
              ELSE ''
            END
          )::text AS definition
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
      ), column_metadata AS (
        SELECT
          'column' AS "objectKind",
          format('%s:%s', a.attrelid, a.attnum) AS "objectIdentity",
          jsonb_build_object(
            'name', a.attname,
            'type', a.atttypid::regtype::text,
            'notNull', a.attnotnull,
            'identity', a.attidentity,
            'generated', a.attgenerated,
            'default', COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
          )::text AS definition
        FROM pg_attribute AS a
        JOIN pg_class AS c ON c.oid = a.attrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ), constraint_metadata AS (
        SELECT
          'constraint' AS "objectKind",
          con.oid::text AS "objectIdentity",
          jsonb_build_object(
            'name', con.conname,
            'type', con.contype,
            'relation', con.conrelid::text,
            'index', con.conindid::text,
            'deferrable', con.condeferrable,
            'deferred', con.condeferred,
            'validated', con.convalidated,
            'definition', pg_get_constraintdef(con.oid, true)
          )::text AS definition
        FROM pg_constraint AS con
        LEFT JOIN pg_class AS c ON c.oid = con.conrelid
        JOIN pg_namespace AS n ON n.oid = con.connamespace
        WHERE n.nspname = $1
      ), trigger_metadata AS (
        SELECT
          'trigger' AS "objectKind",
          trigger_row.oid::text AS "objectIdentity",
          jsonb_build_object(
            'name', trigger_row.tgname,
            'enabled', trigger_row.tgenabled,
            'definition', pg_get_triggerdef(trigger_row.oid, true)
          )::text AS definition
        FROM pg_trigger AS trigger_row
        JOIN pg_class AS c ON c.oid = trigger_row.tgrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND NOT trigger_row.tgisinternal
      ), function_metadata AS (
        SELECT
          'function' AS "objectKind",
          p.oid::text AS "objectIdentity",
          jsonb_build_object(
            'name', p.proname,
            'kind', p.prokind,
            'arguments', p.proargtypes::text,
            'returnType', p.prorettype::regtype::text,
            'acl', COALESCE(p.proacl::text, ''),
            'definition', pg_get_functiondef(p.oid)
          )::text AS definition
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = $1
      ), type_metadata AS (
        SELECT
          'type' AS "objectKind",
          t.oid::text AS "objectIdentity",
          jsonb_build_object(
            'name', t.typname,
            'kind', t.typtype,
            'category', t.typcategory,
            'owner', pg_get_userbyid(t.typowner),
            'acl', COALESCE(t.typacl::text, ''),
            'definition', format_type(t.oid, NULL)
          )::text AS definition
        FROM pg_type AS t
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname = $1
      ), enum_metadata AS (
        SELECT
          'enum_value' AS "objectKind",
          format('%s:%s', e.enumtypid, e.enumsortorder) AS "objectIdentity",
          jsonb_build_object('label', e.enumlabel)::text AS definition
        FROM pg_enum AS e
        JOIN pg_type AS t ON t.oid = e.enumtypid
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname = $1
      ), policy_metadata AS (
        SELECT
          'policy' AS "objectKind",
          p.oid::text AS "objectIdentity",
          jsonb_build_object(
            'name', p.polname,
            'permissive', p.polpermissive,
            'roles', p.polroles::text,
            'command', p.polcmd,
            'using', COALESCE(pg_get_expr(p.polqual, p.polrelid), ''),
            'check', COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
          )::text AS definition
        FROM pg_policy AS p
        JOIN pg_class AS c ON c.oid = p.polrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
      ), extension_metadata AS (
        SELECT
          'extension' AS "objectKind",
          e.oid::text AS "objectIdentity",
          jsonb_build_object('name', e.extname, 'version', e.extversion)::text AS definition
        FROM pg_extension AS e
        JOIN pg_namespace AS n ON n.oid = e.extnamespace
        WHERE n.nspname = $1
      )
      SELECT "objectKind", "objectIdentity", definition FROM schema_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM relation_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM column_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM constraint_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM trigger_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM function_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM type_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM enum_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM policy_metadata
      UNION ALL SELECT "objectKind", "objectIdentity", definition FROM extension_metadata
      ORDER BY "objectKind", "objectIdentity"
    `,
    [schemaName],
  );

  return {
    exists: metadata.rows.some((object) => object.objectKind === 'schema'),
    objects: metadata.rows,
  };
}

const application = buildApi({
  authVerifier: {
    verify: async (token) => {
      const accountId = new Map([
        ['account-a-token', accountA],
        ['account-b-token', accountB],
      ]).get(token);

      if (!accountId) {
        throw new Error('invalid test token');
      }

      return { accountId };
    },
  },
  historyReader: createAnalysisHistoryReader(database.db),
  redisUrl: testRedisUrl,
});

beforeAll(async () => {
  expect(await readSchemaState('app')).toEqual({ exists: false, objects: [] });
  expect(await readSchemaState('neon_auth')).toEqual({ exists: false, objects: [] });

  await database.pool.query('CREATE SCHEMA "neon_auth"');
  await database.pool.query(
    'CREATE TABLE "neon_auth"."migration_sentinel" ("value" text NOT NULL)',
  );
  await database.pool.query('INSERT INTO "neon_auth"."migration_sentinel" ("value") VALUES ($1)', [
    neonAuthSentinel,
  ]);
  neonAuthBeforeMigration = await readSchemaState('neon_auth');

  await migrateDatabase(database.db, migrationsFolder);

  expect(await readSchemaState('neon_auth')).toEqual(neonAuthBeforeMigration);
  await expect(
    database.pool.query<{ value: string }>('SELECT "value" FROM "neon_auth"."migration_sentinel"'),
  ).resolves.toMatchObject({ rows: [{ value: neonAuthSentinel }] });
  expect((await readSchemaState('app')).exists).toBe(true);

  await database.db.insert(analyses).values([
    {
      id: accountAActive,
      accountId: accountA,
      status: 'queued',
      createdAt: new Date('2026-08-01T00:02:00.000Z'),
    },
    {
      id: accountACanceled,
      accountId: accountA,
      status: 'canceled',
      createdAt: new Date('2026-08-01T00:03:00.000Z'),
    },
    {
      id: accountBActive,
      accountId: accountB,
      status: 'completed',
      result: historyDefinitiveResult,
      createdAt: new Date('2026-08-01T00:04:00.000Z'),
    },
    {
      id: accountACompleted,
      accountId: accountA,
      status: 'completed',
      language: 'taglish',
      result: historyDefinitiveResult,
      createdAt: new Date('2026-08-01T00:05:00.000Z'),
    },
    {
      id: accountAInconclusive,
      accountId: accountA,
      status: 'completed',
      language: 'english',
      result: historyInconclusiveResult,
      createdAt: new Date('2026-08-01T00:06:00.000Z'),
    },
    {
      id: accountAFailed,
      accountId: accountA,
      status: 'failed',
      language: 'tagalog',
      createdAt: new Date('2026-08-01T00:07:00.000Z'),
    },
    {
      id: accountAProcessing,
      accountId: accountA,
      status: 'processing',
      language: 'taglish',
      createdAt: new Date('2026-08-01T00:08:00.000Z'),
    },
    {
      id: accountATieFirst,
      accountId: accountA,
      status: 'queued',
      language: 'taglish',
      createdAt: new Date('2026-08-02T00:00:00.000Z'),
    },
    {
      id: accountATieSecond,
      accountId: accountA,
      status: 'queued',
      language: 'taglish',
      createdAt: new Date('2026-08-02T00:00:00.000Z'),
    },
  ]);

  researchFake = buildResearchFake();
  researchFakeUrl = await researchFake.listen({ host: '127.0.0.1', port: 0 });

  const storage = createGcsSourceAudioStorage({
    endpoint: testGcsEndpoint,
    bucket: `damdai-integration-${process.pid}`,
    projectId: 'damdai-integration',
  });
  integrationStorage = storage;
  integrationQueue = createAnalysisQueue(testRedisUrl);
  analysisServices = createAnalysisServices({
    repository: createAnalysisRepository(database.db),
    storage,
    queue: {
      enqueue: async (job) => {
        integrationJobs.push(job);
        await integrationQueue!.enqueue(job);
      },
    },
    researchClient: createResearchSystemClient({ baseUrl: researchFakeUrl }),
    telemetry: integrationTelemetry,
  });
  const upload = await analysisServices.createUpload({
    accountId: accountA,
    language: 'taglish',
    contractVersion: 'taglish-v2',
  });
  integrationUploadId = upload.upload.id;
  integrationObjectKey = upload.upload.objectKey;
  const sourceUpload = await fetch(upload.uploadUrl, {
    method: upload.uploadMethod,
    headers: upload.uploadHeaders,
    body: createPcmWav(1).buffer as ArrayBuffer,
  });
  expect(sourceUpload.ok).toBe(true);
  analysisApplication = buildApi({
    authVerifier: {
      verify: async (token) => {
        const accountId = new Map([
          ['account-a-token', accountA],
          ['account-b-token', accountB],
        ]).get(token);
        if (!accountId) throw new Error('invalid test token');
        return { accountId };
      },
    },
    historyReader: createAnalysisHistoryReader(database.db),
    analysisServices,
    redisUrl: testRedisUrl,
    loggerInstance: integrationLogger,
    telemetry: integrationTelemetry,
  });
  integrationWorker = createAnalysisWorker({
    redisUrl: testRedisUrl,
    processAnalysis: analysisServices.processAnalysis,
    logger: integrationLogger,
    telemetry: integrationTelemetry,
  });
  await integrationWorker.waitUntilReady();
});

afterAll(async () => {
  await integrationWorker?.close();
  await application.close();
  await analysisApplication?.close();
  await integrationQueue?.close();
  await researchFake?.close();
  await database.pool.end();
});

async function waitForCompletedAnalysis(analysisId: string): Promise<Record<string, unknown>> {
  let lastStatus = 'unknown';

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await analysisApplication!.inject({
      method: 'GET',
      url: `/api/v2/analyses/${analysisId}`,
      headers: { authorization: 'Bearer account-a-token' },
    });

    if (response.statusCode === 200) {
      const body = response.json() as Record<string, unknown>;
      lastStatus = String(body.status);
      if (body.status === 'completed') return body;
      if (body.status === 'failed') throw new Error('Integration Analysis failed');
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Analysis did not complete; last status was ${lastStatus}`);
}

describe('real database history ownership boundary', () => {
  it('returns only the authenticated account history through Fastify and the HTTP endpoint', async () => {
    const accountAResponse = await application.inject({
      method: 'GET',
      url: '/api/v2/analyses',
      headers: { authorization: 'Bearer account-a-token' },
    });

    expect(accountAResponse.statusCode).toBe(200);
    expect(accountAResponse.json()).toEqual({
      analyses: [
        {
          id:
            accountATieFirst.localeCompare(accountATieSecond) > 0
              ? accountATieFirst
              : accountATieSecond,
          status: 'queued',
          language: 'taglish',
          createdAt: '2026-08-02T00:00:00.000Z',
        },
        {
          id:
            accountATieFirst.localeCompare(accountATieSecond) > 0
              ? accountATieSecond
              : accountATieFirst,
          status: 'queued',
          language: 'taglish',
          createdAt: '2026-08-02T00:00:00.000Z',
        },
        {
          id: accountAProcessing,
          status: 'processing',
          language: 'taglish',
          createdAt: '2026-08-01T00:08:00.000Z',
        },
        {
          id: accountAFailed,
          status: 'failed',
          language: 'tagalog',
          createdAt: '2026-08-01T00:07:00.000Z',
        },
        {
          id: accountAInconclusive,
          status: 'completed',
          language: 'english',
          createdAt: '2026-08-01T00:06:00.000Z',
          result: {
            outcome: 'inconclusive',
            transcript: historyInconclusiveResult.transcript,
          },
        },
        {
          id: accountACompleted,
          status: 'completed',
          language: 'taglish',
          createdAt: '2026-08-01T00:05:00.000Z',
          result: {
            outcome: 'definitive',
            emotionClassification: 'happiness',
            transcript: historyDefinitiveResult.transcript,
          },
        },
        {
          id: accountAActive,
          status: 'queued',
          language: 'taglish',
          createdAt: '2026-08-01T00:02:00.000Z',
        },
      ],
      hasMore: false,
    });

    const accountBResponse = await application.inject({
      method: 'GET',
      url: '/api/v2/analyses',
      headers: { authorization: 'Bearer account-b-token' },
    });

    expect(accountBResponse.statusCode).toBe(200);
    expect(accountBResponse.json()).toEqual({
      analyses: [
        {
          id: accountBActive,
          status: 'completed',
          language: 'taglish',
          createdAt: '2026-08-01T00:04:00.000Z',
          result: {
            outcome: 'definitive',
            emotionClassification: 'happiness',
            transcript: historyDefinitiveResult.transcript,
          },
        },
      ],
      hasMore: false,
    });
  });

  it('applies every History filter through the real repository and keeps ordering bounded', async () => {
    const cases = [
      { query: 'search=Masaya', expectedIds: [accountACompleted] },
      { query: 'status=failed', expectedIds: [accountAFailed] },
      { query: 'result=inconclusive', expectedIds: [accountAInconclusive] },
      { query: 'result=happiness', expectedIds: [accountACompleted] },
      { query: 'language=english', expectedIds: [accountAInconclusive] },
      {
        query: 'from=2026-08-01&to=2026-08-01&status=completed',
        expectedIds: [accountAInconclusive, accountACompleted],
      },
      {
        query:
          'search=Masaya&status=completed&result=happiness&language=taglish&from=2026-08-01&to=2026-08-01&limit=1',
        expectedIds: [accountACompleted],
      },
    ];

    for (const testCase of cases) {
      const response = await application.inject({
        method: 'GET',
        url: `/api/v2/analyses?${testCase.query}`,
        headers: { authorization: 'Bearer account-a-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().analyses.map((analysis: { id: string }) => analysis.id)).toEqual(
        testCase.expectedIds,
      );
    }

    const tieIds = [accountATieFirst, accountATieSecond].sort((left, right) =>
      right.localeCompare(left),
    );
    const bounded = await application.inject({
      method: 'GET',
      url: '/api/v2/analyses?from=2026-08-02&to=2026-08-02&limit=1',
      headers: { authorization: 'Bearer account-a-token' },
    });

    expect(bounded.statusCode).toBe(200);
    expect(bounded.json()).toEqual({
      analyses: [
        {
          id: tieIds[0],
          status: 'queued',
          language: 'taglish',
          createdAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      hasMore: true,
    });
  });

  it('leaves the Neon Auth schema unchanged while migrating the application schema', async () => {
    expect(await readSchemaState('neon_auth')).toEqual(neonAuthBeforeMigration);
    await expect(
      database.pool.query<{ value: string }>(
        'SELECT "value" FROM "neon_auth"."migration_sentinel"',
      ),
    ).resolves.toMatchObject({ rows: [{ value: neonAuthSentinel }] });
  });

  it('persists one queued Analysis, completes it through the worker seam, and enforces ownership', async () => {
    expect(analysisApplication).toBeDefined();
    expect(analysisServices).toBeDefined();

    const submitted = await analysisApplication!.inject({
      method: 'POST',
      url: '/api/v2/analyses',
      headers: { authorization: 'Bearer account-a-token' },
      payload: { uploadId: integrationUploadId },
    });

    expect(submitted.statusCode).toBe(202);
    const submittedAnalysisId = submitted.json().analysis.id as string;
    expect(integrationJobs).toHaveLength(1);
    expect(integrationJobs[0]).toEqual({
      analysisId: submittedAnalysisId,
      language: 'taglish',
      contractVersion: 'taglish-v2',
    });

    const completed = await waitForCompletedAnalysis(submittedAnalysisId);
    expect(completed).toMatchObject({
      id: submittedAnalysisId,
      status: 'completed',
      result: { emotionClassification: 'happiness' },
    });
    await expect(integrationStorage!.stat(integrationObjectKey)).resolves.toBeNull();

    expect(integrationTelemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'analysis.queued',
          analysisId: submittedAnalysisId,
          stage: 'queued',
        }),
        expect.objectContaining({
          name: 'analysis.worker.received',
          analysisId: submittedAnalysisId,
          stage: 'processing',
          jobId: expect.any(String),
        }),
        expect.objectContaining({
          name: 'analysis.stage',
          analysisId: submittedAnalysisId,
          stage: 'processing',
        }),
        expect.objectContaining({
          name: 'analysis.stage',
          analysisId: submittedAnalysisId,
          stage: 'completed',
        }),
      ]),
    );
    const logs = integrationLogChunks.join('');
    expect(logs).toContain(submittedAnalysisId);
    expect(logs).toContain('analysis queued');
    expect(logs).toContain('Received analysis job');
    for (const sentinel of [
      'SENTINEL_AUDIO',
      'SENTINEL_TRANSCRIPT',
      'SENTINEL_EXPLANATION',
      'SENTINEL_TRACE',
      'SENTINEL_SIGNED_URL',
      'SENTINEL_TOKEN',
      'SENTINEL_EMAIL',
    ]) {
      expect(logs).not.toContain(sentinel);
    }

    const otherAccount = await analysisApplication!.inject({
      method: 'GET',
      url: `/api/v2/analyses/${submittedAnalysisId}`,
      headers: { authorization: 'Bearer account-b-token' },
    });
    expect(otherAccount.statusCode).toBe(404);
  }, 15_000);
});
