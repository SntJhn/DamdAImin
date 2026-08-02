import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  analyses,
  createAnalysisHistoryReader,
  createDatabase,
  migrateDatabase,
} from '@damdai/database';

import { buildApi } from './app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required; run pnpm test:integration');
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
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/database/drizzle',
);
const neonAuthSentinel = 'migration must not change this row';
let neonAuthBeforeMigration: DatabaseSchemaState;

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
      createdAt: new Date('2026-08-01T00:04:00.000Z'),
    },
  ]);
});

afterAll(async () => {
  await application.close();
  await database.pool.end();
});

describe('real database history ownership boundary', () => {
  it('returns only the authenticated account history through Fastify and the HTTP endpoint', async () => {
    const accountAResponse = await application.inject({
      method: 'GET',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer account-a-token' },
    });

    expect(accountAResponse.statusCode).toBe(200);
    expect(accountAResponse.json()).toEqual({
      analyses: [
        {
          id: accountAActive,
          status: 'queued',
          createdAt: '2026-08-01T00:02:00.000Z',
        },
      ],
    });

    const accountBResponse = await application.inject({
      method: 'GET',
      url: '/api/v1/analyses',
      headers: { authorization: 'Bearer account-b-token' },
    });

    expect(accountBResponse.statusCode).toBe(200);
    expect(accountBResponse.json()).toEqual({
      analyses: [
        {
          id: accountBActive,
          status: 'completed',
          createdAt: '2026-08-01T00:04:00.000Z',
        },
      ],
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
});
