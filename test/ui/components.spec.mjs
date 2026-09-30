/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */

/**
 * Playwright over the component harness (test/ui/harness.tsx), which mounts the
 * real DiscountTable and DeployReport against fixture payloads.
 *
 * Deliberately NOT part of `npm run predeploy`: it needs a browser and a served
 * page. Run it when the components change:
 *
 *   npm run test:ui
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const HARNESS = 'file://' + path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness.html');

// The UI Kit checkbox renders a visually hidden <input> inside a styled <label>;
// the label is what a user clicks, so that is what the test clicks.
const checkbox = (page, label) => page.locator(`label:has(input[aria-label="${label}"])`);
const box = (page, label) => page.locator(`input[aria-label="${label}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await page.waitForSelector('#selected-count');
});

test('a discount with no key cannot be selected, and says why', async ({ page }) => {
  const row = page.locator('#tables tr', { hasText: 'Legacy promo with no key' });
  await expect(box(page, 'Select Legacy promo with no key')).toBeDisabled();
  await expect(row).toContainText('it has no key');
});

test('status reads "New" when the key is absent from the target, "In production" when present', async ({
  page,
}) => {
  await expect(page.locator('#tables tr', { hasText: 'HomeDecor10Pct' })).toContainText('New');
  await expect(page.locator('#tables tr', { hasText: 'FreeShip100' })).toContainText(
    'In production'
  );
});

test('selecting a row updates the selection', async ({ page }) => {
  await expect(page.locator('#selected-count')).toHaveAttribute('data-count', '1');
  await checkbox(page, 'Select Spring 20').click();
  await expect(page.locator('#selected-count')).toHaveAttribute('data-count', '2');
});

test('select-all picks every deployable row and skips the keyless one', async ({ page }) => {
  // starts with HomeDecor10Pct selected; select-all adds FreeShip100 but not the
  // keyless row, so the count is 2 rather than 3
  await checkbox(page, 'Select all Cart discounts').click();
  await expect(page.locator('#selected-count')).toHaveAttribute('data-count', '2');
  await expect(box(page, 'Select Legacy promo with no key')).not.toBeChecked();
});

test('deselecting works as well as selecting', async ({ page }) => {
  await checkbox(page, 'Select 10% Off Home Decor').click();
  await expect(page.locator('#selected-count')).toHaveAttribute('data-count', '0');
});

test('the report lists the dependencies it pulled in', async ({ page }) => {
  const panel = page.locator('#report-main', { hasText: 'Also deploying' });
  await expect(panel).toContainText('SpringSale20');
  await expect(panel).toContainText('seasonal-promos');
});

test('a blocker is shown with the remedy, not just the failure', async ({ page }) => {
  const panel = page.locator('#report-main');
  await expect(panel).toContainText('must be fixed before this can deploy');
  await expect(panel).toContainText('code must be unique');
  await expect(panel).toContainText('Give that one the key "BOGO"');
});

test('the diff shows a verb and the changed fields per resource', async ({ page }) => {
  const row = page.locator('#report-main tr', { hasText: 'HomeDecor10Pct' });
  await expect(row).toContainText('update');
  await expect(row).toContainText('changeValue, changeName, changeIsActive');
});

test('a no-op is shown rather than hidden', async ({ page }) => {
  await expect(page.locator('#report-main tr', { hasText: 'FreeShip100' })).toContainText(
    'no change'
  );
});

test('a failed write is reported with the API message', async ({ page }) => {
  const panel = page.locator('#report-main');
  await expect(panel).toContainText('write(s) failed');
  await expect(panel).toContainText('A discount code with code "BOGO" already exists.');
});

test('an all-no-op diff still renders, so "nothing changed" is visible', async ({ page }) => {
  await expect(page.locator('#report-empty')).toContainText('already match');
  await expect(page.locator('#report-empty')).toContainText('0 to create');
});

test('a key deep-links to its Merchant Center editing screen, in a new tab', async ({ page }) => {
  const link = page.locator('#tables a', { hasText: 'FreeShip100' });
  await expect(link).toHaveAttribute('href', '/stage-project/discounts/carts/cd-1/general');
  await expect(link).toHaveAttribute('target', '_blank');
  // losing the selection and diff to a same-tab navigation is the thing to avoid
  await expect(link).toHaveAttribute('rel', 'noreferrer');
});

test('each resource type links to its own Merchant Center route', async ({ page }) => {
  await expect(page.locator('#tables a', { hasText: 'SPRING20' })).toHaveAttribute(
    'href',
    '/stage-project/discounts/codes/dc-1/general'
  );
});

test('a discount group is not linked, because it has no editing screen', async ({ page }) => {
  const row = page.locator('#tables tr', { hasText: 'seasonal-promos' });
  await expect(row).toContainText('seasonal-promos');
  await expect(row.locator('a')).toHaveCount(0);
});

test('a keyless row is neither linked nor selectable', async ({ page }) => {
  const row = page.locator('#tables tr', { hasText: 'Legacy promo with no key' });
  await expect(row.locator('a')).toHaveCount(0);
  await expect(row).toContainText('no key');
});

test('an id-bearing predicate is warned about, separately from blockers', async ({ page }) => {
  const panel = page.locator('#report-main');
  await expect(panel).toContainText('worth knowing before this deploys');
  await expect(panel).toContainText('embeds the id of category "home-decor"');
  await expect(panel).toContainText('categories.key');
});
