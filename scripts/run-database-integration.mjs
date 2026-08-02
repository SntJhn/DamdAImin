import { execFile, spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const postgresImage = 'postgres:18-alpine';
const postgresDatabase = 'damdai_integration';
const postgresUser = 'damdai_integration';
const postgresPassword = 'damdai_integration_password';
const containerName = `damdai-integration-postgres-${process.pid}`;

async function runDocker(args) {
  const { stdout } = await execFileAsync('docker', args, {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim();
}

async function waitForPostgres(containerId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await runDocker([
        'exec',
        containerId,
        'pg_isready',
        '-U',
        postgresUser,
        '-d',
        postgresDatabase,
      ]);
      return;
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`PostgreSQL container ${containerId} did not become ready`);
}

async function readMappedPort(containerId) {
  const output = await runDocker(['port', containerId, '5432/tcp']);
  const port = output.match(/:(\d+)(?:\s|$)/)?.[1];

  if (!port) {
    throw new Error(`Could not determine the mapped PostgreSQL port from: ${output}`);
  }

  return port;
}

function runVitest(environment) {
  return new Promise((resolve, reject) => {
    const testProcess = spawn(
      'pnpm',
      ['exec', 'vitest', 'run', 'apps/api/src/history-reader.integration.test.ts'],
      {
        env: environment,
        stdio: 'inherit',
      },
    );

    testProcess.once('error', reject);
    testProcess.once('exit', (code) => resolve(code ?? 1));
  });
}

let containerId;
let exitCode = 1;

try {
  containerId = await runDocker([
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    `POSTGRES_DB=${postgresDatabase}`,
    '--env',
    `POSTGRES_USER=${postgresUser}`,
    '--env',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    postgresImage,
  ]);

  await waitForPostgres(containerId);
  const port = await readMappedPort(containerId);
  const testEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_URL: `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${port}/${postgresDatabase}`,
  };

  delete testEnvironment.DATABASE_URL;
  delete testEnvironment.INTEGRATION_DATABASE_URL;
  delete testEnvironment.RUN_DATABASE_INTEGRATION_TESTS;

  exitCode = await runVitest(testEnvironment);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
} finally {
  if (containerId) {
    try {
      await runDocker(['rm', '--force', containerId]);
    } catch (error) {
      process.stderr.write(
        `Could not remove disposable PostgreSQL container ${containerId}: ${error instanceof Error ? error.message : error}\n`,
      );
      exitCode = exitCode === 0 ? 1 : exitCode;
    }
  }
}

process.exitCode = exitCode;
