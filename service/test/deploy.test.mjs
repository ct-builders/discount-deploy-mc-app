/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClient, uuid } from './helpers.mjs';
import {
  rewritePredicate,
  deployBundle,
  validateAgainstTarget,
  collectConflicts,
} from '../lib/deploy.mjs';

const SRC_CAT = uuid(1);
const TGT_CAT = uuid(7);

const target = (extra = {}) =>
  fakeClient('prod', {
    categories: [{ id: TGT_CAT, key: 'home-decor' }],
    'cart-discounts': [],
    'product-discounts': [],
    'discount-codes': [],
    'discount-groups': [],
    ...extra,
  });

const cartDiscount = (over = {}) => ({
  resourceType: 'cart-discount',
  key: 'CD',
  name: { 'en-US': '10% off' },
  value: { type: 'relative', permyriad: 1000 },
  cartPredicate: `lineItemExists(categories.id contains any ("${SRC_CAT}"))`,
  target: { type: 'lineItems', predicate: `categories.id contains any ("${SRC_CAT}")` },
  sortOrder: '0.5',
  isActive: true,
  requiresDiscountCode: false,
  stackingMode: 'Stacking',
  stores: [],
  referenceMap: { [SRC_CAT]: { typeId: 'category', key: 'home-decor' } },
  ...over,
});

test("a predicate's source id is replaced by the target's id for the same key", async () => {
  const t = target();
  const out = await rewritePredicate(t, `categories.id contains any ("${SRC_CAT}")`, {
    [SRC_CAT]: { typeId: 'category', key: 'home-decor' },
  });
  assert.ok(out.includes(TGT_CAT), 'target id present');
  assert.ok(!out.includes(SRC_CAT), 'source id gone');
});

test('a key-based predicate needs no rewriting and is left alone', async () => {
  const t = target();
  const p = 'categories.key contains any ("home-decor")';
  assert.equal(await rewritePredicate(t, p, {}), p);
});

test('an absent key is created, and the created draft carries the rewritten predicate', async () => {
  const t = target();
  const r = await deployBundle(t, { cartDiscounts: [cartDiscount()] }, { dryRun: false });
  assert.equal(r.summary.create, 1);
  const write = t.writes.find((w) => w.kind === 'create');
  assert.ok(write.draft.cartPredicate.includes(TGT_CAT));
  assert.ok(write.draft.target.predicate.includes(TGT_CAT));
  assert.equal(write.draft.key, 'CD');
});

test('deploying the same bundle twice is a no-op the second time', async () => {
  const t = target();
  await deployBundle(t, { cartDiscounts: [cartDiscount()] }, { dryRun: false });
  const before = t.writes.length;
  const r = await deployBundle(t, { cartDiscounts: [cartDiscount()] }, { dryRun: false });
  assert.equal(r.summary.noop, 1);
  assert.equal(r.summary.update, 0);
  assert.equal(t.writes.length, before, 'no further writes');
});

test('only the fields that changed become update actions', async () => {
  const t = target();
  await deployBundle(t, { cartDiscounts: [cartDiscount()] }, { dryRun: false });
  t.writes.length = 0;
  const changedOne = cartDiscount({ value: { type: 'relative', permyriad: 2500 } });
  const r = await deployBundle(t, { cartDiscounts: [changedOne] }, { dryRun: false });
  assert.equal(r.summary.update, 1);
  const actions = t.writes[0].actions.map((a) => a.action);
  assert.deepEqual(actions, ['changeValue']);
});

test('a dry run reports the same verdict but writes nothing', async () => {
  const t = target();
  const r = await deployBundle(t, { cartDiscounts: [cartDiscount()] }, { dryRun: true });
  assert.equal(r.summary.create, 1);
  assert.equal(t.writes.length, 0);
});

test('a reference missing from the target is reported before any write', async () => {
  const t = target({ categories: [] });
  const missing = await validateAgainstTarget(t, { cartDiscounts: [cartDiscount()] });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].reason, 'not-in-target');
  assert.equal(missing[0].typeId, 'category');
});

test('a reference satisfied by this same deploy is not reported missing', async () => {
  const t = target();
  const bundle = {
    discountGroups: [
      {
        resourceType: 'discount-group',
        key: 'seasonal',
        name: {},
        sortOrder: '0.1',
        isActive: true,
      },
    ],
    cartDiscounts: [cartDiscount({ discountGroup: { typeId: 'discount-group', key: 'seasonal' } })],
  };
  assert.deepEqual(await validateAgainstTarget(t, bundle), []);
});

test('a duplicate discount-code value in the target is flagged as a conflict', async () => {
  // the target already has code "BOGO", but with no key — so a key lookup misses it
  const t = target({ 'discount-codes': [{ id: uuid(8), code: 'BOGO' }] });
  const conflicts = await collectConflicts(t, { discountCodes: [{ key: 'BOGO', code: 'BOGO' }] });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, 'duplicate-code-in-target');
  assert.equal(conflicts[0].conflictingKey, null);
});

test('no conflict is reported when the code is matched by key (an update)', async () => {
  const t = target({ 'discount-codes': [{ id: uuid(8), key: 'BOGO', code: 'BOGO' }] });
  assert.deepEqual(
    await collectConflicts(t, { discountCodes: [{ key: 'BOGO', code: 'BOGO' }] }),
    []
  );
});

test('resource types are applied in dependency order', async () => {
  const t = target();
  const r = await deployBundle(
    t,
    {
      discountCodes: [
        {
          resourceType: 'discount-code',
          key: 'C',
          code: 'C',
          cartDiscounts: [{ typeId: 'cart-discount', key: 'CD' }],
          referenceMap: {},
        },
      ],
      cartDiscounts: [cartDiscount()],
      discountGroups: [
        { resourceType: 'discount-group', key: 'G', name: {}, sortOrder: '0.1', isActive: true },
      ],
    },
    { dryRun: true }
  );
  assert.deepEqual(
    r.order.map((o) => o.type),
    ['discount-group', 'cart-discount', 'discount-code']
  );
});
