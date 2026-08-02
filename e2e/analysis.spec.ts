import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const analysisId = '8b9f1d42-4a34-4f1e-9a73-8d1c5d5e1a01';

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

  await page.locator('#analysis-file').setInputFiles({
    name: 'synthetic.wav',
    mimeType: 'audio/wav',
    buffer: createPcmWav(),
  });
  await page.getByRole('button', { name: 'Submit Analysis' }).click();

  await expect(page).toHaveURL(`/analyses/${analysisId}`);
});

test('shows a persisted completed result and has no accessibility violations', async ({ page }) => {
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
          technicalTrace: [{ cue: 'synthetic-positive-cue', value: 'happiness' }],
          contractVersion: 'taglish-v1',
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
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
  await page.waitForTimeout(2_100);
  expect(reads).toBe(1);
});
