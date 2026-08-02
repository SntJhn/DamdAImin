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
const redisImage = 'redis:7-alpine';
const redisContainerName = `damdai-integration-redis-${process.pid}`;
const fakeGcsImage = 'fsouza/fake-gcs-server:1.52.3';
const fakeGcsContainerName = `damdai-integration-fake-gcs-${process.pid}`;

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

async function waitForFakeGcs(containerId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await runDocker([
        'exec',
        containerId,
        'wget',
        '-q',
        '--spider',
        'http://localhost:4443/storage/v1/b',
      ]);
      return;
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`fake-GCS container ${containerId} did not become ready`);
}

async function waitForRedis(containerId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await runDocker(['exec', containerId, 'redis-cli', 'ping']);
      return;
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`Redis container ${containerId} did not become ready`);
}

async function readMappedPort(containerId, containerPort) {
  const output = await runDocker(['port', containerId, containerPort]);
  const port = output.match(/:(\d+)(?:\s|$)/)?.[1];

  if (!port) {
    throw new Error(`Could not determine the mapped port from: ${output}`);
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
let redisContainerId;
let fakeGcsContainerId;
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
  const port = await readMappedPort(containerId, '5432/tcp');
  redisContainerId = await runDocker([
    'run',
    '--detach',
    '--rm',
    '--name',
    redisContainerName,
    '--publish',
    '127.0.0.1::6379',
    redisImage,
  ]);
  await waitForRedis(redisContainerId);
  const redisPort = await readMappedPort(redisContainerId, '6379/tcp');
  fakeGcsContainerId = await runDocker([
    'run',
    '--detach',
    '--rm',
    '--name',
    fakeGcsContainerName,
    '--publish',
    '127.0.0.1::4443',
    fakeGcsImage,
    '-scheme',
    'http',
    '-port',
    '4443',
    '-backend',
    'memory',
  ]);
  await waitForFakeGcs(fakeGcsContainerId);
  const fakeGcsPort = await readMappedPort(fakeGcsContainerId, '4443/tcp');
  const testEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    TEST_DATABASE_URL: `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${port}/${postgresDatabase}`,
    TEST_REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    TEST_GCS_ENDPOINT: `http://127.0.0.1:${fakeGcsPort}`,
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
  if (fakeGcsContainerId) {
    try {
      await runDocker(['rm', '--force', fakeGcsContainerId]);
    } catch (error) {
      process.stderr.write(
        `Could not remove disposable fake-GCS container ${fakeGcsContainerId}: ${error instanceof Error ? error.message : error}\n`,
      );
      exitCode = exitCode === 0 ? 1 : exitCode;
    }
  }
  if (redisContainerId) {
    try {
      await runDocker(['rm', '--force', redisContainerId]);
    } catch (error) {
      process.stderr.write(
        `Could not remove disposable Redis container ${redisContainerId}: ${error instanceof Error ? error.message : error}\n`,
      );
      exitCode = exitCode === 0 ? 1 : exitCode;
    }
  }
}

process.exitCode = exitCode;
