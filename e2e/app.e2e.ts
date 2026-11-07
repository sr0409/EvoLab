import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * End-to-end tests for the EvoLab interface (milestone 6). Run with
 * `npm run test:e2e`.
 *
 * These run the real app against the real engine, covering the seams unit
 * tests cannot: the store loop advancing ticks, the readout re-rendering from
 * live engine state, and world creation through the seed input.
 */

async function readTick(page: Page): Promise<number> {
  const text = await page.locator('.readout span').first().textContent();
  const match = /tick (\d+)/.exec(text ?? '');
  if (!match) throw new Error(`could not read tick from: ${text}`);
  return Number(match[1]);
}

async function readCreatureCount(page: Page): Promise<number> {
  const text = await page.locator('.readout span').nth(3).textContent();
  const match = /(\d+) creatures/.exec(text ?? '');
  if (!match) throw new Error(`could not read creature count from: ${text}`);
  return Number(match[1]);
}

test('the app loads with a world, a live readout, and a populated simulation', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.brand')).toContainText('EvoLab');
  await expect(page.locator('.readout')).toContainText(/tick \d+/);
  await expect(page.locator('.readout')).toContainText(/seed: \S+/);
  expect(await readCreatureCount(page)).toBeGreaterThan(0);
});

test('Step advances the simulation exactly one tick per click while paused', async ({ page }) => {
  await page.goto('/');
  const before = await readTick(page);

  await page.getByRole('button', { name: 'Step' }).click();
  await page.getByRole('button', { name: 'Step' }).click();

  expect(await readTick(page)).toBe(before + 2);
});

test('Run advances ticks and Pause stops them', async ({ page }) => {
  await page.goto('/');
  const start = await readTick(page);

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // Default speed preset is 5 ticks/s; one second of runtime is unambiguous.
  await page.waitForTimeout(1500);
  expect(await readTick(page)).toBeGreaterThan(start);

  await page.getByRole('button', { name: 'Pause' }).click();
  const stopped = await readTick(page);
  await page.waitForTimeout(800);
  expect(await readTick(page)).toBe(stopped);
});

test('a new world resets the tick and honours the entered seed', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Run' }).click();
  await page.waitForTimeout(600);
  expect(await readTick(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();

  await page.getByPlaceholder(/^seed: /).fill('e2e-seed');
  await page.getByRole('button', { name: 'New world' }).click();

  await expect(page.locator('.readout')).toContainText('seed: e2e-seed');
  expect(await readTick(page)).toBe(0);
});
