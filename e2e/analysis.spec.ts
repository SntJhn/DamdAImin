import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const analysisId = '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01';

const definitiveTechnicalTrace = {
  cueSpans: [
    {
      source: 'acoustic',
      startMs: 0,
      endMs: 800,
      cue: 'pitch contour',
      value: 'rising positive contour',
    },
    {
      source: 'linguistic',
      startMs: 850,
      endMs: 1_450,
      cue: 'positive lexical cue',
      value: 'Masaya',
    },
  ],
  activatedRules: [
    {
      id: 'rule-happiness-positive-cue',
      description: 'Positive acoustic and linguistic cues increase the happiness score.',
    },
  ],
  scoreAdjustments: [
    {
      emotionClassification: 'happiness',
      delta: 0.66,
      reason: 'Returned positive acoustic and linguistic cues.',
    },
  ],
  probabilities: {
    before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
    after: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
  },
};

const inconclusiveTechnicalTrace = {
  cueSpans: [],
  activatedRules: [],
  scoreAdjustments: [],
  probabilities: {
    before: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
    after: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
  },
};

function createPcmWav(): Buffer {
  const sampleRateHz = 16_000;
  const dataByteLength = sampleRateHz * 2 * 1;
  const bytes = Buffer.alloc(44 + dataByteLength);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRateHz, 24);
  bytes.writeUInt32LE(sampleRateHz * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataByteLength, 40);
  return bytes;
}

async function mockVerifiedSession(page: Page) {
  await page.route('**/api/auth/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/token')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'verified-token' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'user-1',
          name: 'Verified Fixture',
          email: 'verified@example.test',
          emailVerified: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
        session: {
          id: 'session-1',
          userId: 'user-1',
          token: 'verified-token',
          expiresAt: '2026-08-03T00:00:00.000Z',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    });
  });
}

async function trackRejectedSubmissionCalls(page: Page) {
  const calls = { uploadOperations: 0, analysisCreations: 0 };
  await page.route('**/api/v2/analysis-uploads', async (route) => {
    calls.uploadOperations += 1;
    await route.abort();
  });
  await page.route('**/api/v2/analyses', async (route) => {
    calls.analysisCreations += 1;
    await route.abort();
  });
  return calls;
}

async function mockVirtualMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        oscillator.frequency.value = 220;
        const gain = context.createGain();
        gain.gain.value = 0.2;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await context.resume();
        return destination.stream;
      },
    });
  });
}

async function startAndStopVirtualRecording(page: Page) {
  await page.getByRole('button', { name: 'Record Audio' }).click();
  await expect(page.getByText(/Recording — .* seconds elapsed/)).toBeVisible();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Stop recording' }).click();
}

test('searches and filters Analysis History by emotion and date', async ({ page }) => {
  await mockVerifiedSession(page);
  const requests: string[] = [];

  await page.route('**/api/v2/analyses**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const sad = url.searchParams.get('result') === 'sadness';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hasMore: false,
        analyses: sad
          ? [
              {
                id: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
                status: 'completed',
                language: 'english',
                createdAt: '2026-08-02T00:01:00.000Z',
                result: {
                  outcome: 'definitive',
                  emotionClassification: 'sadness',
                  transcript: 'Hindi malinaw ang sample.',
                },
              },
            ]
          : [
              {
                id: analysisId,
                status: 'completed',
                language: 'taglish',
                createdAt: '2026-08-02T00:00:00.000Z',
                result: {
                  outcome: 'definitive',
                  emotionClassification: 'happiness',
                  transcript: 'Masaya ako sa araw na ito.',
                },
              },
              {
                id: 'c1ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
                status: 'queued',
                language: 'taglish',
                createdAt: '2026-08-02T00:02:00.000Z',
              },
            ],
      }),
    });
  });

  await page.goto('/history');
  await expect(page.getByRole('heading', { name: /Welcome back,/ })).toBeVisible();
  await expect(page.locator('.dashboard-emotion', { hasText: 'Happy' })).toBeVisible();
  await expect(page.locator('.dashboard-emotion', { hasText: 'Queued' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page.getByRole('searchbox', { name: 'Search your analyses' }).fill('Hindi');
  await page.getByText('Filter history', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Lifecycle state' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Analysis language' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Emotion', exact: true }).selectOption('sadness');
  await page.getByLabel('From date', { exact: true }).fill('2026-08-01');
  await page.getByLabel('To date', { exact: true }).fill('2026-08-02');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('.dashboard-emotion', { hasText: 'Sad' })).toBeVisible();
  await expect(
    page.locator('.dashboard-transcript-cell', { hasText: 'Hindi malinaw ang sample.' }),
  ).toBeVisible();
  expect(requests.at(-1)).toContain('search=Hindi');
  expect(requests.at(-1)).toContain('result=sadness');
  expect(requests.at(-1)).toContain('from=2026-08-01');
  expect(requests.at(-1)).toContain('to=2026-08-02');
  expect(requests.at(-1)).not.toMatch(/status=|language=/);
  await expect(
    new AxeBuilder({ page }).include('.dashboard-filter-grid').analyze(),
  ).resolves.toMatchObject({ violations: [] });
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.dashboard-emotion', { hasText: 'Happy' })).toBeVisible();
  expect(requests.at(-1)).toBe('');
  await expect(page.getByRole('navigation', { name: 'Analysis list pagination' })).toContainText(
    'Page 1',
  );
  await page
    .getByRole('link', {
      name: `Open Happy analysis ${analysisId} from Aug 2, 2026`,
    })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/analyses/${analysisId}`);
});

test('paginates loaded analysis history locally and resets the page when searching', async ({
  page,
}) => {
  await mockVerifiedSession(page);
  const requests: URL[] = [];
  const records = Array.from({ length: 23 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    status: 'completed',
    language: 'taglish',
    createdAt: '2026-08-02T00:00:00.000Z',
    result: {
      outcome: 'definitive',
      emotionClassification: 'sadness',
      transcript: `Sad sample ${index + 1}`,
    },
  }));
  await page.route('**/api/v2/analyses**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const search = url.searchParams.get('search');
    const filtered = search
      ? records.filter((record) => record.result.transcript.includes(search))
      : records;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        analyses: filtered,
        hasMore: false,
      }),
    });
  });

  await page.goto('/history');
  const rows = page.locator('.dashboard-table-record');
  const pagination = page.getByRole('navigation', { name: 'Analysis list pagination' });
  const previous = pagination.getByRole('button', { name: 'Previous' });
  const next = pagination.getByRole('button', { name: 'Next' });
  await expect(rows).toHaveCount(10);
  await expect(pagination).toContainText('Page 1');
  await expect(previous).toBeDisabled();
  const initialRequestCount = requests.length;
  await next.click();
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('Sad sample 11');
  await expect(pagination).toContainText('Showing 11–20');
  await next.click();
  await expect(rows).toHaveCount(3);
  await expect(pagination).toContainText('Page 3');
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(rows.first()).toContainText('Sad sample 11');
  expect(requests).toHaveLength(initialRequestCount);
  await expect(
    new AxeBuilder({ page }).include('.dashboard-pagination').analyze(),
  ).resolves.toMatchObject({ violations: [] });
  await page.getByRole('searchbox', { name: 'Search your analyses' }).fill('Sad sample 2');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(rows).toHaveCount(5);
  await expect(pagination).toContainText('Page 1');
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  expect(requests.every((url) => !url.searchParams.has('offset'))).toBe(true);
  expect(requests.every((url) => !url.searchParams.has('limit'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await expect(
    new AxeBuilder({ page }).include('.dashboard-pagination').analyze(),
  ).resolves.toMatchObject({ violations: [] });
});

test('communicates empty, filtered-empty, and API-error History states', async ({ page }) => {
  await mockVerifiedSession(page);
  let failRequests = false;

  await page.route('**/api/v2/analyses**', async (route) => {
    if (failRequests) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'service_unavailable' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        analyses: [],
        hasMore: false,
      }),
    });
  });

  await page.goto('/history');
  await expect(
    page.getByRole('heading', { name: 'Your first reading will live here.' }),
  ).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search your analyses' }).fill('nothing');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Try a wider search.' })).toBeVisible();

  failRequests = true;
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'History is unavailable' })).toContainText(
    'History is unavailable right now. Refresh to try again.',
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});

test('reviews the ASR transcript before submitting one WAV utterance', async ({ page }) => {
  await mockVerifiedSession(page);
  await page.route('**/api/v2/analysis-uploads', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        uploadId: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
        uploadUrl: 'http://upload.test/source.wav',
        uploadMethod: 'PUT',
        uploadHeaders: { 'content-type': 'audio/wav' },
        expiresAt: '2026-08-02T00:15:00.000Z',
      }),
    });
  });
  await page.route('http://upload.test/**', async (route) => {
    await route.fulfill({ status: 200 });
  });
  await page.route('**/api/v2/analysis-uploads/*/transcription-preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transcript: 'Synthetic preview transcript.' }),
    });
  });
  await page.route('**/api/v2/analyses', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { location: `/api/v2/analyses/${analysisId}` },
      body: JSON.stringify({
        analysis: {
          id: analysisId,
          status: 'queued',
          stage: 'queued',
          language: 'taglish',
          createdAt: '2026-08-02T00:00:00.000Z',
        },
        location: `/api/v2/analyses/${analysisId}`,
      }),
    });
  });

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await expect(
    page.getByRole('heading', { name: 'Start an Emotion Analysis.', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Start an Emotion Analysis.' })).toBeVisible();
  await expect(page.getByText('Maximum recording length is 60 seconds.')).toBeVisible();
  await expect(page.getByText('There is no arbitrary minimum duration.')).toBeVisible();
  await expect(page.getByText('Long audio is not segmented into multiple Analyses.')).toBeVisible();

  await page.getByText('Upload a WAV', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /Upload a WAV/ })).toBeChecked();
  await page.locator('#analysis-file').setInputFiles({
    name: 'synthetic.wav',
    mimeType: 'audio/wav',
    buffer: createPcmWav(),
  });
  await page.getByRole('button', { name: 'Generate transcript' }).click();
  await expect(page.getByLabel('ASR-generated transcript (editable)')).toHaveValue(
    'Synthetic preview transcript.',
  );
  await page.getByRole('button', { name: 'Run analysis' }).click();

  await expect(page).toHaveURL(`/analyses/${analysisId}`);
});

test('records virtual synthetic media, replaces it locally, and submits the converted WAV', async ({
  page,
}) => {
  await mockVirtualMicrophone(page);
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'decodeAudioData', {
      configurable: true,
      value: async () => ({
        length: 16_000,
        numberOfChannels: 1,
        sampleRate: 16_000,
        getChannelData: () =>
          Float32Array.from(
            { length: 16_000 },
            (_, index) => Math.sin((index / 16_000) * Math.PI * 2 * 220) * 0.2,
          ),
      }),
    });
  });
  await mockVerifiedSession(page);
  let uploadOperations = 0;
  let analysisCreations = 0;
  let analysisReads = 0;
  let uploadedWav: Buffer | null = null;

  await page.route('**/api/v2/analysis-uploads', async (route) => {
    uploadOperations += 1;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        uploadId: 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a',
        uploadUrl: 'http://upload.test/recorded-source.wav',
        uploadMethod: 'PUT',
        uploadHeaders: { 'content-type': 'audio/wav' },
        expiresAt: '2026-08-02T00:15:00.000Z',
      }),
    });
  });
  await page.route('http://upload.test/**', async (route) => {
    uploadedWav = route.request().postDataBuffer();
    await route.fulfill({ status: 200 });
  });
  await page.route('**/api/v2/analysis-uploads/*/transcription-preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transcript: 'Synthetic virtual microphone fixture.' }),
    });
  });
  await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
    analysisReads += 1;
    const completed = analysisReads > 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: completed ? 'completed' : 'queued',
        stage: completed ? 'completed' : 'queued',
        language: 'english',
        createdAt: '2026-08-02T00:00:00.000Z',
        ...(completed
          ? {
              result: {
                outcome: 'definitive',
                emotionClassification: 'happiness',
                confidence: {
                  happiness: 0.91,
                  sadness: 0.03,
                  anger: 0.02,
                  neutrality: 0.04,
                },
                transcript: 'Synthetic virtual microphone fixture.',
                explanation: 'Synthetic fixture.',
                technicalTrace: definitiveTechnicalTrace,
                contractVersion: 'taglish-v2',
                schemaVersion: 'research-response-v2',
                modelVersion: 'fake-model-1',
                preprocessingVersion: 'fake-preprocessing-1',
                ruleSetVersion: 'fake-rules-1',
              },
            }
          : {}),
      }),
    });
  });
  await page.route('**/api/v2/analyses', async (route) => {
    analysisCreations += 1;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { location: `/api/v2/analyses/${analysisId}` },
      body: JSON.stringify({
        analysis: {
          id: analysisId,
          status: 'queued',
          stage: 'queued',
          language: 'english',
          createdAt: '2026-08-02T00:00:00.000Z',
        },
        location: `/api/v2/analyses/${analysisId}`,
      }),
    });
  });

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');

  const start = page.getByRole('button', { name: 'Record Audio' });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Recording — .* seconds elapsed/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Live microphone waveform' })).toBeVisible();
  await expect(page.locator('.recorder-waveform[data-signal-detected="true"]')).toBeVisible();
  await page.waitForTimeout(500);
  const stop = page.getByRole('button', { name: 'Stop recording' });
  await stop.focus();
  await page.keyboard.press('Space');
  await expect(
    page.locator('.recorder-status').getByText(/WAV Source Audio is ready/),
  ).toBeVisible();
  await expect(page.getByText(/Only the converted WAV remains/)).toBeVisible();
  expect(uploadOperations).toBe(0);
  expect(analysisCreations).toBe(0);

  const discard = page.getByRole('button', { name: 'Discard recording' });
  await discard.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Microphone is ready when you are.')).toBeVisible();
  await page.getByRole('button', { name: 'Generate transcript' }).click();
  await expect(page.getByText('Record one utterance before submitting.')).toBeVisible();
  expect(uploadOperations).toBe(0);
  expect(analysisCreations).toBe(0);

  await startAndStopVirtualRecording(page);
  await expect(
    page.locator('.recorder-status').getByText(/WAV Source Audio is ready/),
  ).toBeVisible();
  await expect(page.getByText('Record one utterance before submitting.')).toBeHidden();

  const replace = page.getByRole('button', { name: 'Replace recording' });
  await replace.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Recording — .* seconds elapsed/)).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(
    page.locator('.recorder-status').getByText(/WAV Source Audio is ready/),
  ).toBeVisible();
  expect(uploadOperations).toBe(0);
  expect(analysisCreations).toBe(0);

  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
  const generateTranscript = page.getByRole('button', { name: 'Generate transcript' });
  await generateTranscript.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('ASR-generated transcript (editable)')).toHaveValue(
    'Synthetic virtual microphone fixture.',
  );
  const runAnalysis = page.getByRole('button', { name: 'Run analysis' });
  await runAnalysis.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/analyses/${analysisId}`);
  await expect(page.getByRole('heading', { name: 'Your signal is safely in line.' })).toBeVisible();
  await expect(page.getByText('Detected emotion')).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole('heading', { name: 'Happy', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Detected emotion')).toBeVisible();

  expect(uploadOperations).toBe(1);
  expect(analysisCreations).toBe(1);
  expect(analysisReads).toBe(3);
  expect(uploadedWav?.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(uploadedWav?.subarray(8, 12).toString('ascii')).toBe('WAVE');
  expect(uploadedWav?.readUInt16LE(20)).toBe(1);
  expect(uploadedWav?.readUInt16LE(34)).toBe(16);
});

test('reports denied microphone permission without creating an Analysis', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Synthetic permission denial', 'NotAllowedError');
        },
      },
    });
  });
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await page.getByRole('button', { name: 'Record Audio' }).click();

  await expect(page.getByText(/Microphone permission was denied/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});

test('reports unavailable microphone hardware without creating an Analysis', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Synthetic missing device', 'NotFoundError');
        },
      },
    });
  });
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await page.getByRole('button', { name: 'Record Audio' }).click();

  await expect(page.getByText(/No microphone is available/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('reports microphone conversion failure without creating an Analysis', async ({ page }) => {
  await mockVirtualMicrophone(page);
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'decodeAudioData', {
      configurable: true,
      value: async () => {
        throw new DOMException('Synthetic decode failure', 'EncodingError');
      },
    });
  });
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await startAndStopVirtualRecording(page);

  await expect(page.getByText(/could not be converted into a valid WAV/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('rejects a silent microphone capture before creating an Analysis', async ({ page }) => {
  await mockVirtualMicrophone(page);
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'decodeAudioData', {
      configurable: true,
      value: async () => ({
        length: 16_000,
        numberOfChannels: 1,
        sampleRate: 16_000,
        getChannelData: () => new Float32Array(16_000),
      }),
    });
  });
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await startAndStopVirtualRecording(page);

  await expect(page.getByText(/No audible speech signal was detected/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('reports invalid converted output without creating an Analysis', async ({ page }) => {
  await mockVirtualMicrophone(page);
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'decodeAudioData', {
      configurable: true,
      value: async () => ({
        length: 16_000,
        numberOfChannels: 1,
        sampleRate: 0,
        getChannelData: () =>
          Float32Array.from({ length: 16_000 }, (_, index) => (index % 2 ? 0.2 : -0.2)),
      }),
    });
  });
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await startAndStopVirtualRecording(page);

  await expect(page.getByText(/could not be converted into a valid WAV/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('stops an over-limit capture without creating an Analysis', async ({ page }) => {
  await mockVirtualMicrophone(page);
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await page.clock.install();
  await page.getByRole('button', { name: 'Record Audio' }).click();
  await expect(page.getByText(/Recording — .* seconds elapsed/)).toBeVisible();
  await page.clock.fastForward(60_200);

  await expect(page.getByText(/Recording exceeded the 60-second maximum/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('shows a persisted completed result after reload and has no accessibility violations', async ({
  page,
}) => {
  await mockVerifiedSession(page);
  let reads = 0;
  await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
    reads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: 'completed',
        stage: 'completed',
        language: 'taglish',
        createdAt: '2026-08-02T00:00:00.000Z',
        result: {
          outcome: 'definitive',
          emotionClassification: 'happiness',
          confidence: { happiness: 0.91, sadness: 0.03, anger: 0.02, neutrality: 0.04 },
          transcript: 'Masaya ako sa araw na ito.',
          explanation: 'Synthetic fixture.',
          technicalTrace: definitiveTechnicalTrace,
          contractVersion: 'taglish-v2',
          schemaVersion: 'research-response-v2',
          modelVersion: 'fake-model-1',
          preprocessingVersion: 'fake-preprocessing-1',
          ruleSetVersion: 'fake-rules-1',
        },
      }),
    });
  });

  await page.goto(`/analyses/${analysisId}`);
  await expect(page.getByText('verified@example.test')).toHaveText('verified@example.test');
  await expect(page.getByText('Detected emotion')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Happy', exact: true })).toBeVisible();
  await expect(page.getByText('Score Breakdown')).toBeVisible();
  await expect(
    page.locator('.analysis-result-confidence').getByText('91%', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'How DamdAImin reached this result' }),
  ).toBeVisible();
  const resultPath = page.getByRole('list', { name: 'How the system reached the result' });
  await expect(resultPath.getByText('clues found', { exact: true })).toBeVisible();
  await expect(resultPath.getByText('rule applied', { exact: true })).toBeVisible();
  await expect(resultPath.getByText('Happy', { exact: true })).toBeVisible();
  await expect(resultPath.getByText('91% Final Confidence', { exact: true })).toBeVisible();

  const technicalTrace = page.locator('.analysis-trace-technical > summary');
  await technicalTrace.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Words That Stood Out', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Scoring rules used', { exact: true })).toBeVisible();
  await expect(page.getByText('How clues shifted the scores', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Scores before and after clue adjustments', { exact: true }),
  ).toBeVisible();
  const versionIdentifiers = page
    .locator('summary')
    .filter({ hasText: 'Model and system versions' });
  await versionIdentifiers.click();
  await expect(page.getByText('research-response-v2', { exact: true })).toBeVisible();
  await expect(page.getByText('fake-model-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /edit|correct/i })).toHaveCount(0);
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
  await page.reload();
  await expect(page.getByText('Detected emotion')).toBeVisible();
  await page.waitForTimeout(2_100);
  expect(reads).toBe(2);
});

test('presents an Inconclusive Result without a headline class or visible raw probabilities', async ({
  page,
}) => {
  await mockVerifiedSession(page);
  await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: 'completed',
        stage: 'completed',
        language: 'english',
        createdAt: '2026-08-02T00:00:00.000Z',
        result: {
          outcome: 'inconclusive',
          confidence: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
          transcript: '',
          explanation:
            'The returned fixture did not provide sufficient acoustic and linguistic evidence for a definitive classification.',
          technicalTrace: inconclusiveTechnicalTrace,
          contractVersion: 'english-v2',
          schemaVersion: 'research-response-v2',
          modelVersion: 'fake-model-1',
          preprocessingVersion: 'fake-preprocessing-1',
          ruleSetVersion: 'fake-rules-1',
        },
      }),
    });
  });

  await page.goto(`/analyses/${analysisId}`);
  await expect(page.getByRole('heading', { name: 'Inconclusive Result' })).toBeVisible();
  await expect(
    page.getByText(
      'The Research System did not return a sufficiently reliable classification for this speech sample.',
    ),
  ).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Experimental', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Score Breakdown')).toHaveCount(0);
  await expect(page.locator('.probability-table')).toBeHidden();
  await expect(page.getByRole('button', { name: /edit|correct/i })).toHaveCount(0);

  const resultPath = page.getByRole('list', { name: 'How the system reached the result' });
  await expect(resultPath.getByText('No clear result', { exact: true })).toBeVisible();
  await expect(resultPath.getByText('Inconclusive', { exact: true })).toBeVisible();

  const technicalTrace = page.locator('.analysis-trace-technical > summary');
  await technicalTrace.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Scores before and after clue adjustments', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('25%', { exact: true }).first()).toBeVisible();
  await expect(
    page.locator('.analysis-cue-section').getByText('No specific words or sounds were flagged.'),
  ).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});

test('cancels a queued Analysis and removes it from the active journey', async ({ page }) => {
  await mockVerifiedSession(page);
  let canceled = false;
  await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: canceled ? 'canceled' : 'queued',
        stage: canceled ? 'canceled' : 'queued',
        language: 'taglish',
        createdAt: '2026-08-02T00:00:00.000Z',
        retryAvailable: false,
      }),
    });
  });
  await page.route(`**/api/v2/analyses/${analysisId}/cancel`, async (route) => {
    canceled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: 'canceled',
        stage: 'canceled',
        language: 'taglish',
        createdAt: '2026-08-02T00:00:00.000Z',
        retryAvailable: false,
      }),
    });
  });

  await page.goto(`/analyses/${analysisId}`);
  await expect(page.getByRole('heading', { name: 'Your signal is safely in line.' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Analysis queued' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Analysis progress' })).toContainText(
    'Waiting to start',
  );
  await expect(page.getByRole('button', { name: 'Cancel Analysis' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel Analysis' }).click();
  await expect(page.getByText('This Analysis was canceled.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel Analysis' })).toHaveCount(0);
});

test('shows when the Research System is actively processing an Analysis', async ({ page }) => {
  await mockVerifiedSession(page);
  await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: 'processing',
        stage: 'processing',
        language: 'taglish',
        createdAt: '2026-08-02T00:00:00.000Z',
        retryAvailable: false,
      }),
    });
  });

  await page.goto(`/analyses/${analysisId}`);
  await expect(
    page.getByRole('heading', { name: 'DamdAImin is reading your signal.' }),
  ).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Analysis processing' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Analysis progress' })).toContainText(
    'In progress now',
  );
  await expect(
    page.getByText(
      'We’re turning your recording into text and analyzing it. This can take a few minutes.',
    ),
  ).toBeVisible();
});

test('retries a failed Analysis only when retained Source Audio is available', async ({ page }) => {
  await mockVerifiedSession(page);
  const retriedAnalysisId = 'a0ad9a3f-26b2-4014-8f51-ec7d67bb4f1a';
  await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: 'failed',
        stage: 'failed',
        language: 'taglish',
        createdAt: '2026-08-02T00:00:00.000Z',
        failureMessage:
          'The Research System could not complete this Analysis. Retry while retained Source Audio is available.',
        retryAvailable: true,
      }),
    });
  });
  await page.route(`**/api/v2/analyses/${analysisId}/retry`, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { location: `/api/v2/analyses/${retriedAnalysisId}` },
      body: JSON.stringify({
        analysis: {
          id: retriedAnalysisId,
          status: 'queued',
          stage: 'queued',
          language: 'taglish',
          createdAt: '2026-08-02T00:00:00.000Z',
          retryAvailable: false,
          retryOfAnalysisId: analysisId,
        },
        location: `/api/v2/analyses/${retriedAnalysisId}`,
      }),
    });
  });

  await page.goto(`/analyses/${analysisId}`);
  await expect(page.getByRole('button', { name: 'Retry Analysis' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry Analysis' }).click();
  await expect(page).toHaveURL(`/analyses/${retriedAnalysisId}`);
});

for (const [classification, label] of [
  ['happiness', 'Happy'],
  ['sadness', 'Sad'],
  ['anger', 'Angry'],
  ['neutrality', 'Neutral'],
] as const) {
  test(`renders ${label} evidence truthfully with accessible colors`, async ({ page }) => {
    await mockVerifiedSession(page);
    const neutralScores = { happiness: 0.1, sadness: 0.1, anger: 0.1, neutrality: 0.7 };
    const symbolic =
      classification === 'neutrality'
        ? { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 }
        : { happiness: 0.1166667, sadness: 0.1166667, anger: 0.1166666, neutrality: 0.65 };
    const combined = { happiness: 0.1, sadness: 0.1, anger: 0.1, neutrality: 0.1 };
    combined[classification] = 0.7;
    const acousticReason =
      "PROSODIC_ENERGY_RATE detected 'energy and speaking rate' and reported a increase adjustment.";
    const computedReason =
      "CONTRADICTION_RECALIBRATION detected 'neural-symbolic disagreement' and reported a decrease adjustment.";
    await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: analysisId,
          status: 'completed',
          stage: 'completed',
          language: 'taglish',
          createdAt: '2026-08-02T00:00:00.000Z',
          result: {
            outcome: 'definitive',
            emotionClassification: classification,
            confidence: combined,
            transcript: 'Synthetic fixture.',
            explanation: 'Synthetic fixture.',
            technicalTrace: {
              ...definitiveTechnicalTrace,
              activatedRules: [
                { id: 'PROSODIC_ENERGY_RATE-1', description: 'Returned acoustic rule evidence.' },
                {
                  id: 'CONTRADICTION_RECALIBRATION-2',
                  description: 'Returned comparison evidence.',
                },
              ],
              scoreAdjustments: [
                { emotionClassification: 'anger', delta: 0.05, reason: acousticReason },
                { emotionClassification: 'neutrality', delta: -0.05, reason: computedReason },
              ],
              probabilities: { before: neutralScores, symbolic, after: combined },
            },
            contractVersion: 'taglish-v2',
            schemaVersion: 'research-response-v2',
            modelVersion: 'fake-model-1',
            preprocessingVersion: 'fake-preprocessing-1',
            ruleSetVersion: 'fake-rules-1',
          },
        }),
      });
    });

    await page.goto(`/analyses/${analysisId}`);
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    for (const layer of ['Neural Layer', 'Symbolic Layer', 'Combined Result']) {
      const percentages = await page
        .getByRole('region', { name: layer, exact: true })
        .locator('.analysis-result-confidence-label strong')
        .allTextContents();
      expect(percentages).toHaveLength(4);
      expect(percentages.reduce((sum, value) => sum + Number.parseInt(value), 0)).toBe(100);
    }
    if (classification === 'neutrality') {
      await expect(
        page.getByText('The symbolic layer gave all four emotions equal scores (25% each).', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        page.getByText('The layers leaned toward different emotions', { exact: false }),
      ).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await page.locator('.analysis-trace-technical > summary').click();
    await expect(page.getByText('Returned acoustic rule evidence.', { exact: true })).toBeVisible();
    await expect(page.getByText('Returned comparison evidence.', { exact: true })).toBeVisible();
    await expect(page.getByText(acousticReason, { exact: true })).toBeVisible();
    await expect(page.getByText(computedReason, { exact: true })).toBeVisible();
    await expect(
      page.getByText('The word or phrase “energy and speaking rate”', { exact: false }),
    ).toHaveCount(0);
    await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
  });
}

test('shows normalized layer totals, authoritative cue effects, and keyboard-accessible symbolic replay', async ({
  page,
}) => {
  await mockVerifiedSession(page);
  const scores = { happiness: 0.118, sadness: 0.118, anger: 0.118, neutrality: 0.646 };
  const explanation = 'Adaptive fusion assigned 15% weight to audio and 85% to symbolic evidence.';
  await page.route(`**/api/v2/analyses/${analysisId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: analysisId,
        status: 'completed',
        stage: 'completed',
        language: 'taglish',
        createdAt: '2026-08-02T00:00:00.000Z',
        result: {
          outcome: 'definitive',
          emotionClassification: 'neutrality',
          confidence: scores,
          transcript: 'masaya ako pero hindi masaya ngayon',
          explanation,
          technicalTrace: {
            cueSpans: [
              {
                source: 'linguistic',
                startMs: 0,
                endMs: 1000,
                cue: 'LEXICAL_EMOTION',
                value: 'masaya',
              },
              {
                source: 'linguistic',
                startMs: 1000,
                endMs: 2000,
                cue: 'LEXICAL_NEGATION',
                value: 'hindi',
              },
            ],
            activatedRules: [{ id: 'LEXICAL_EMOTION-1', description: 'Emotion contribution.' }],
            scoreAdjustments: [
              {
                cue: 'masaya',
                ruleId: 'LEXICAL_EMOTION',
                emotionClassification: 'happiness',
                delta: 0.25,
                reason: 'First occurrence.',
              },
              {
                cue: 'masaya',
                ruleId: 'LEXICAL_EMOTION',
                emotionClassification: 'happiness',
                delta: -0.125,
                reason: 'Negated occurrence.',
              },
            ],
            scoreJourney: [
              {
                cue: 'Starting symbolic scores',
                ruleId: 'BASELINE',
                source: 'baseline',
                scores: { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 },
              },
              { cue: 'hindi masaya', ruleId: 'LEXICAL_EMOTION', source: 'linguistic', scores },
            ],
            probabilities: { before: scores, symbolic: scores, after: scores },
          },
          contractVersion: 'taglish-v2',
          schemaVersion: 'research-response-v2',
          modelVersion: 'fake-model-1',
          preprocessingVersion: 'fake-preprocessing-1',
          ruleSetVersion: 'fake-rules-1',
        },
      }),
    });
  });
  await page.goto(`/analyses/${analysisId}`);
  for (const layer of ['Neural Layer', 'Symbolic Layer', 'Combined Result']) {
    const percentages = await page
      .getByRole('region', { name: layer, exact: true })
      .locator('.analysis-result-confidence-label strong')
      .allTextContents();
    expect(percentages.reduce((sum, value) => sum + Number.parseInt(value), 0)).toBe(100);
  }
  const cueRow = page.getByRole('row').filter({ hasText: '“masaya”' });
  await expect(cueRow.getByText('Happy +0.25 evidence', { exact: true })).toBeVisible();
  await expect(cueRow.getByText('Happy -0.13 evidence', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '“hindi”' })).toContainText(
    'Context cue or per-cue evidence unavailable',
  );
  const baseline = page.getByRole('button', { name: /Symbolic baseline, Neutral/ });
  await baseline.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close explanation' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'hindi masaya' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(baseline).toBeFocused();
  await page.locator('.analysis-trace-technical > summary').click();
  await page.getByText('Show the original explanation', { exact: true }).click();
  await expect(page.getByText(explanation, { exact: true })).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});
