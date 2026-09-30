/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClient, uuid } from './helpers.mjs';
import { listDiscounts, expandSelection, prepare, apply } from '../lib/diff.mjs';

const CD_ID = uuid(2);
const DG_ID = uuid(3);

const stage = () =>
  fakeClient('stage', {
    'discount-groups': [
      {
        id: DG_ID,
        key: 'seasonal',
        name: { 'en-US': 'Seasonal' },
        sortOrder: '0.5',
        isActive: true,
      },
    ],
    'cart-discounts': [
      {
        id: CD_ID,
        key: 'SpringSale20',
        name: { 'en-US': 'Spring Sale' },
        value: { type: 'relative', permyriad: 2000 },
        cartPredicate: 'true',
        target: { type: 'lineItems', predicate: 'true' },
        sortOrder: '0.6',
        isActive: true,
        requiresDiscountCode: true,
        stackingMode: 'Stacking',
        discountGroup: { typeId: 'discount-group', id: DG_ID },
      },
    ],
    'product-discounts': [
      {
        id: uuid(4),
        key: 'PD1',
        name: { 'en-US': 'PD' },
        value: { type: 'relative', permyriad: 500 },
        predicate: 'true',
        sortOrder: '0.1',
        isActive: true,
      },
    ],
    'discount-codes': [
      {
        id: uuid(5),
        key: 'SPRING20',
        code: 'SPRING20',
        name: { 'en-US': 'Spring' },
        cartDiscounts: [{ typeId: 'cart-discount', id: CD_ID }],
        isActive: true,
      },
    ],
  });

const emptyTarget = () =>
  fakeClient('prod', {
    'discount-groups': [],
    'cart-discounts': [],
    'product-discounts': [],
    'discount-codes': [],
    categories: [],
  });

test('the list marks each discount as already in the target or new', async () => {
  const s = stage();
  const t = fakeClient('prod', {
    'discount-groups': [],
    'cart-discounts': [{ id: uuid(9), key: 'SpringSale20' }],
    'product-discounts': [],
    'discount-codes': [],
  });
  const out = await listDiscounts(s, t);
  assert.equal(out.cartDiscounts[0].existsInTarget, true);
  assert.equal(out.productDiscounts[0].existsInTarget, false);
  assert.equal(out.cartDiscounts[0].name, 'Spring Sale');
  assert.equal(out.cartDiscounts[0].value, '20% off');
});

test('each row carries the id and a link to its source-project screen', async () => {
  const out = await listDiscounts(stage(), emptyTarget());
  assert.equal(out.cartDiscounts[0].id, CD_ID);
  assert.equal(
    out.cartDiscounts[0].editPath,
    `/stage/discounts/carts/${CD_ID}/general`,
    'built from the source project key, not the target'
  );
  assert.equal(out.productDiscounts[0].editPath.includes('/discounts/products/'), true);
  assert.equal(out.discountCodes[0].editPath.includes('/discounts/codes/'), true);
});

test('a discount group row has no link, because there is no such screen', async () => {
  const out = await listDiscounts(stage(), emptyTarget());
  assert.equal(out.discountGroups[0].editPath, null);
});

test('a resource with no key is reported as not deployable', async () => {
  const s = fakeClient('stage', {
    'cart-discounts': [{ id: uuid(1), name: { 'en-US': 'keyless' } }],
    'discount-groups': [],
    'product-discounts': [],
    'discount-codes': [],
  });
  const out = await listDiscounts(s, emptyTarget());
  assert.equal(out.cartDiscounts[0].deployable, false);
  assert.equal(out.cartDiscounts[0].key, null);
});

test('selecting a discount code pulls in its cart discount and that group', async () => {
  const { selection, added } = await expandSelection(stage(), { discountCodes: ['SPRING20'] });
  assert.deepEqual(selection.cartDiscounts, ['SpringSale20']);
  assert.deepEqual(selection.discountGroups, ['seasonal']);
  assert.equal(added.length, 2);
  assert.match(added[0].reason, /required by discount code/);
  assert.match(added[1].reason, /required by cart discount/);
});

test('dependency expansion can be turned off', async () => {
  const r = await prepare(
    stage(),
    emptyTarget(),
    { discountCodes: ['SPRING20'] },
    { autoDeps: false }
  );
  assert.deepEqual(r.added, []);
  // without its cart discount present anywhere, the code is not deployable
  assert.ok(r.blockers.some((b) => b.kind === 'not-in-target'));
});

test('expansion does not duplicate something already selected', async () => {
  const { selection } = await expandSelection(stage(), {
    discountCodes: ['SPRING20'],
    cartDiscounts: ['SpringSale20'],
  });
  assert.deepEqual(selection.cartDiscounts, ['SpringSale20']);
});

test('an empty selection prepares as nothing rather than failing', async () => {
  const r = await prepare(stage(), emptyTarget(), {});
  assert.equal(r.results, null);
  assert.deepEqual(r.blockers, []);
});

test('preparing reports the full chain as creates and writes nothing', async () => {
  const t = emptyTarget();
  const r = await prepare(stage(), t, { discountCodes: ['SPRING20'] });
  assert.deepEqual(r.blockers, []);
  assert.equal(r.summary.create, 3);
  assert.equal(t.writes.length, 0);
});

test('apply refuses to write when there is a blocker', async () => {
  const t = emptyTarget();
  const r = await apply(stage(), t, { discountCodes: ['SPRING20'] }, { autoDeps: false });
  assert.equal(r.applied, false);
  assert.equal(r.reason, 'blocked');
  assert.equal(t.writes.length, 0, 'nothing written');
});

test('force overrides a blocker', async () => {
  const t = emptyTarget();
  const r = await apply(
    stage(),
    t,
    { discountCodes: ['SPRING20'] },
    { autoDeps: false, force: true }
  );
  assert.equal(r.applied, true);
  assert.ok(t.writes.length > 0);
});

test('apply writes the chain and reports it applied', async () => {
  const t = emptyTarget();
  const r = await apply(stage(), t, { discountCodes: ['SPRING20'] });
  assert.equal(r.applied, true);
  assert.equal(r.summary.create, 3);
  assert.deepEqual(
    t.writes.map((w) => w.endpoint),
    ['discount-groups', 'cart-discounts', 'discount-codes']
  );
});

test("'*' selects every resource of a type", async () => {
  const r = await prepare(stage(), emptyTarget(), { productDiscounts: '*' });
  assert.equal(r.summary.create, 1);
});

test('an id-bearing predicate warns but still deploys', async () => {
  const CAT = uuid(7);
  const s = fakeClient('stage', {
    categories: [{ id: CAT, key: 'home-decor' }],
    'cart-discounts': [
      {
        id: uuid(8),
        key: 'CD',
        name: { 'en-US': 'x' },
        value: { type: 'relative', permyriad: 1000 },
        cartPredicate: `lineItemExists(categories.id contains any ("${CAT}"))`,
        target: { type: 'lineItems', predicate: 'true' },
        sortOrder: '0.5',
        isActive: true,
      },
    ],
    'discount-groups': [],
    'product-discounts': [],
    'discount-codes': [],
  });
  const t = fakeClient('prod', {
    categories: [{ id: uuid(9), key: 'home-decor' }],
    'cart-discounts': [],
    'discount-groups': [],
    'product-discounts': [],
    'discount-codes': [],
  });
  const r = await prepare(s, t, { cartDiscounts: ['CD'] });
  assert.deepEqual(r.blockers, [], 'it translates, so it is not a blocker');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].detail, /embeds the id of category "home-decor"/);
  assert.match(r.warnings[0].detail, /categories\.key/);
  assert.equal(r.summary.create, 1);
});

test('a key-based predicate produces no warning at all', async () => {
  const r = await prepare(stage(), emptyTarget(), { productDiscounts: ['PD1'] });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.idReferences, []);
});

test('a blocked deploy still answers 200-shaped with applied false', async () => {
  const t = emptyTarget();
  const r = await apply(stage(), t, { discountCodes: ['SPRING20'] }, { autoDeps: false });
  assert.equal(r.applied, false);
  assert.equal(r.reason, 'blocked');
  assert.ok(r.blockers.length > 0, 'the blockers travel with the report');
  assert.equal(t.writes.length, 0);
});
