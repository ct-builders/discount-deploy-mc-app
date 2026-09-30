/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClient, uuid } from './helpers.mjs';
import {
  buildReferenceMap,
  serializeCartDiscount,
  serializeProductDiscount,
  serializeDiscountCode,
  collectUnresolved,
  collectIdReferences,
} from '../lib/serialize.mjs';

const CAT = uuid(1);
const stage = () =>
  fakeClient('stage', {
    categories: [{ id: CAT, key: 'home-decor' }],
    'cart-discounts': [{ id: uuid(2), key: 'CD1' }],
  });

test('a uuid inside a predicate is resolved to its typeId and key', async () => {
  const c = stage();
  const map = await buildReferenceMap(c, [`categories.id contains any ("${CAT}")`]);
  assert.deepEqual(map[CAT], { typeId: 'category', key: 'home-decor' });
});

test('a uuid that matches nothing in the source is recorded as unresolved', async () => {
  const c = stage();
  const ghost = uuid(9);
  const map = await buildReferenceMap(c, [`categories.id contains any ("${ghost}")`]);
  assert.equal(map[ghost].key, null);
  assert.equal(map[ghost].unresolved, true);
});

test('an expanded reference supplies the typeId without probing', async () => {
  const c = stage();
  const map = await buildReferenceMap(
    c,
    [`categories.id contains any ("${CAT}")`],
    [{ typeId: 'category', id: CAT }]
  );
  assert.equal(map[CAT].typeId, 'category');
  assert.equal(map[CAT].key, 'home-decor');
});

test('a cart discount serializes its stores and group by key, never by id', async () => {
  const c = fakeClient('stage', {
    stores: [{ id: uuid(3), key: 'us-store' }],
    'discount-groups': [{ id: uuid(4), key: 'seasonal' }],
    categories: [{ id: CAT, key: 'home-decor' }],
  });
  const out = await serializeCartDiscount(c, {
    key: 'CD',
    name: { 'en-US': 'x' },
    value: { type: 'relative', permyriad: 1000 },
    cartPredicate: `lineItemExists(categories.id contains any ("${CAT}"))`,
    stores: [{ typeId: 'store', id: uuid(3) }],
    discountGroup: { typeId: 'discount-group', id: uuid(4) },
  });
  assert.deepEqual(out.stores, [{ typeId: 'store', key: 'us-store' }]);
  assert.deepEqual(out.discountGroup, { typeId: 'discount-group', key: 'seasonal' });
  // the predicate itself is carried verbatim; rewriting happens at deploy time
  assert.ok(out.cartPredicate.includes(CAT));
  assert.deepEqual(out.referenceMap[CAT], { typeId: 'category', key: 'home-decor' });
});

test('a discount code serializes the cart discounts it points at by key', async () => {
  const c = stage();
  const out = await serializeDiscountCode(c, {
    key: 'C',
    code: 'C',
    cartDiscounts: [{ typeId: 'cart-discount', id: uuid(2) }],
  });
  assert.deepEqual(out.cartDiscounts, [{ typeId: 'cart-discount', key: 'CD1' }]);
});

test('collectUnresolved reports a store that has no key in the source', async () => {
  const c = fakeClient('stage', { stores: [{ id: uuid(5) }] }); // no key
  const cd = await serializeCartDiscount(c, {
    key: 'CD',
    stores: [{ typeId: 'store', id: uuid(5) }],
  });
  const problems = collectUnresolved({ cartDiscounts: [cd] });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'store');
});

// ---- the pre-deploy id audit ----

test('an id embedded in a predicate is reported as translatable, with the key form to use instead', async () => {
  const c = stage();
  const cd = await serializeCartDiscount(c, {
    key: 'CD',
    cartPredicate: `lineItemExists(categories.id contains any ("${CAT}"))`,
  });
  const refs = collectIdReferences({ cartDiscounts: [cd] });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].status, 'translatable');
  assert.equal(refs[0].typeId, 'category');
  assert.equal(refs[0].resolvedKey, 'home-decor');
  assert.equal(refs[0].keyFormHint, 'categories.key');
});

test('an id that matches nothing in the source is reported as unresolved', async () => {
  const c = stage();
  const ghost = uuid(9);
  const cd = await serializeCartDiscount(c, {
    key: 'CD',
    cartPredicate: `categories.id contains any ("${ghost}")`,
  });
  const refs = collectIdReferences({ cartDiscounts: [cd] });
  assert.equal(refs[0].status, 'unresolved-in-source');
  assert.equal(refs[0].resolvedKey, null);
});

test('a key-based predicate embeds no ids, so the audit is empty', async () => {
  const c = stage();
  const cd = await serializeCartDiscount(c, {
    key: 'CD',
    cartPredicate: 'categories.key contains any ("home-decor")',
  });
  assert.deepEqual(collectIdReferences({ cartDiscounts: [cd] }), []);
});

test('the audit covers product discounts and discount codes too', async () => {
  const c = stage();
  const pd = await serializeProductDiscount(c, {
    key: 'PD',
    predicate: `categories.id contains any ("${CAT}")`,
  });
  const dc = await serializeDiscountCode(c, {
    key: 'DC',
    code: 'DC',
    cartPredicate: `lineItemExists(categories.id contains any ("${CAT}"))`,
  });
  const refs = collectIdReferences({ productDiscounts: [pd], discountCodes: [dc] });
  assert.deepEqual(
    refs.map((r) => [r.resourceType, r.field]),
    [
      ['product-discount', 'predicate'],
      ['discount-code', 'cartPredicate'],
    ]
  );
});

test('a custom type id resolves rather than blocking the deploy', async () => {
  const typeId = uuid(6);
  const c = fakeClient('stage', { types: [{ id: typeId, key: 'my-custom-type' }] });
  const cd = await serializeCartDiscount(c, {
    key: 'CD',
    cartPredicate: `custom.type.id = "${typeId}"`,
  });
  const refs = collectIdReferences({ cartDiscounts: [cd] });
  assert.equal(refs[0].typeId, 'type');
  assert.equal(refs[0].resolvedKey, 'my-custom-type');
  assert.equal(refs[0].keyFormHint, 'custom.type.key');
});
