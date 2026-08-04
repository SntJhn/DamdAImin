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
  await page.route('**/api/v1/analysis-uploads', async (route) => {
    calls.uploadOperations += 1;
    await route.abort();
  });
  await page.route('**/api/v1/analyses', async (route) => {
    calls.analysisCreations += 1;
    await route.abort();
  });
  return calls;
}

async function startAndStopVirtualRecording(page: Page) {
  await page.getByRole('button', { name: 'Grant access and record' }).click();
  await expect(page.getByText(/Recording — .* seconds elapsed/)).toBeVisible();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Stop recording' }).click();
}

test('submits one WAV utterance and lands on the durable Analysis resource', async ({ page }) => {
  await mockVerifiedSession(page);
  await page.route('**/api/v1/analysis-uploads', async (route) => {
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
  await page.route('**/api/v1/analyses', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { location: `/api/v1/analyses/${analysisId}` },
      body: JSON.stringify({
        analysis: {
          id: analysisId,
          status: 'queued',
          stage: 'queued',
          language: 'taglish',
          createdAt: '2026-08-02T00:00:00.000Z',
        },
        location: `/api/v1/analyses/${analysisId}`,
      }),
    });
  });

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'One utterance. One honest signal.' }),
  ).toBeVisible();
  await expect(
    page.getByText('The Research System owns the detectable-speech rule.'),
  ).toBeVisible();
  await expect(
    page.getByText('The application imposes no arbitrary minimum duration.'),
  ).toBeVisible();
  await expect(page.getByText('Long audio is not segmented into multiple Analyses.')).toBeVisible();

  await page.getByRole('radio', { name: 'Upload WAV' }).check();
  await page.locator('#analysis-file').setInputFiles({
    name: 'synthetic.wav',
    mimeType: 'audio/wav',
    buffer: createPcmWav(),
  });
  await page.getByRole('button', { name: 'Submit Analysis' }).click();

  await expect(page).toHaveURL(`/analyses/${analysisId}`);
});

test('records virtual synthetic media, replaces it locally, and submits the converted WAV', async ({
  page,
}) => {
  await mockVerifiedSession(page);
  let uploadOperations = 0;
  let analysisCreations = 0;
  let analysisReads = 0;
  let uploadedWav: Buffer | null = null;

  await page.route('**/api/v1/analysis-uploads', async (route) => {
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
  await page.route(`**/api/v1/analyses/${analysisId}`, async (route) => {
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
  await page.route('**/api/v1/analyses', async (route) => {
    analysisCreations += 1;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { location: `/api/v1/analyses/${analysisId}` },
      body: JSON.stringify({
        analysis: {
          id: analysisId,
          status: 'queued',
          stage: 'queued',
          language: 'english',
          createdAt: '2026-08-02T00:00:00.000Z',
        },
        location: `/api/v1/analyses/${analysisId}`,
      }),
    });
  });

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await page.locator('#analysis-language').focus();
  await page.keyboard.press('ArrowDown');

  const start = page.getByRole('button', { name: 'Grant access and record' });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Recording — .* seconds elapsed/)).toBeVisible();
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
  await page.getByRole('button', { name: 'Submit Analysis' }).click();
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
  const submit = page.getByRole('button', { name: 'Submit Analysis' });
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/analyses/${analysisId}`);
  await expect(page.getByText('queued', { exact: true })).toBeVisible();
  await expect(page.getByText('Emotion Classification')).toBeVisible({ timeout: 4_000 });
  await page.reload();
  await expect(page.getByText('Emotion Classification')).toBeVisible();

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
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await page.getByRole('button', { name: 'Grant access and record' }).click();

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
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await page.getByRole('button', { name: 'Grant access and record' }).click();

  await expect(page.getByText(/No microphone is available/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('reports microphone conversion failure without creating an Analysis', async ({ page }) => {
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
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await startAndStopVirtualRecording(page);

  await expect(page.getByText(/could not be converted into a valid WAV/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('reports invalid converted output without creating an Analysis', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'decodeAudioData', {
      configurable: true,
      value: async () => ({
        length: 0,
        numberOfChannels: 1,
        sampleRate: 16_000,
        getChannelData: () => new Float32Array(),
      }),
    });
  });
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await startAndStopVirtualRecording(page);

  await expect(page.getByText(/could not be converted into a valid WAV/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('stops an over-limit capture without creating an Analysis', async ({ page }) => {
  await mockVerifiedSession(page);
  const calls = await trackRejectedSubmissionCalls(page);

  await page.goto('/analyze');
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await page.clock.install();
  await page.getByRole('button', { name: 'Grant access and record' }).click();
  await expect(page.getByText(/Recording — .* seconds elapsed/)).toBeVisible();
  await page.clock.fastForward(20_200);

  await expect(page.getByText(/Recording exceeded the 20-second maximum/)).toBeVisible();
  expect(calls).toEqual({ uploadOperations: 0, analysisCreations: 0 });
});

test('shows a persisted completed result after reload and has no accessibility violations', async ({
  page,
}) => {
  await mockVerifiedSession(page);
  let reads = 0;
  await page.route(`**/api/v1/analyses/${analysisId}`, async (route) => {
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
  await expect(page.getByText('verified@example.test')).toBeVisible();
  await expect(page.getByText('Emotion Classification')).toBeVisible();
  await expect(page.getByText('happiness', { exact: true })).toBeVisible();
  await expect(page.getByText('Confidence breakdown')).toBeVisible();
  await expect(
    page.locator('.analysis-confidence').getByText('91%', { exact: true }),
  ).toBeVisible();

  const technicalTrace = page.locator('summary').filter({ hasText: 'Technical Trace' });
  await technicalTrace.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cue spans', { exact: true })).toBeVisible();
  await expect(page.getByText('Activated rules', { exact: true })).toBeVisible();
  await expect(page.getByText('Score adjustments', { exact: true })).toBeVisible();
  await expect(page.getByText('Before-and-after probabilities', { exact: true })).toBeVisible();
  await expect(page.getByText('Version identifiers', { exact: true })).toBeVisible();
  await expect(page.getByText('research-response-v2', { exact: true })).toBeVisible();
  await expect(page.getByText('fake-model-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /edit|correct/i })).toHaveCount(0);
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
  await page.reload();
  await expect(page.getByText('Emotion Classification')).toBeVisible();
  await page.waitForTimeout(2_100);
  expect(reads).toBe(2);
});

test('presents an Inconclusive Result without a headline class or visible raw probabilities', async ({
  page,
}) => {
  await mockVerifiedSession(page);
  await page.route(`**/api/v1/analyses/${analysisId}`, async (route) => {
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
    page.getByText('No definitive classification is shown for this completed Analysis.'),
  ).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();
  await expect(page.getByText('Experimental', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'It does not provide a definitive classification because the returned evidence was insufficient.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Confidence breakdown')).toHaveCount(0);
  await expect(page.locator('.probability-table')).toBeHidden();
  await expect(page.getByRole('button', { name: /edit|correct/i })).toHaveCount(0);

  const technicalTrace = page.locator('summary').filter({ hasText: 'Technical Trace' });
  await technicalTrace.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Before-and-after probabilities', { exact: true })).toBeVisible();
  await expect(page.getByText('25%', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No cue spans were returned.')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});
