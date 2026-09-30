/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDiscount, mcEditPath, money, pickName } from '../lib/util.mjs';

test('a percentage against line items reads as a plain percentage', () => {
  assert.equal(
    describeDiscount(
      { type: 'relative', permyriad: 1500 },
      { type: 'lineItems', predicate: 'true' }
    ),
    '15% off'
  );
});

test('100% off shipping is free shipping, not a free order', () => {
  assert.equal(
    describeDiscount({ type: 'relative', permyriad: 10000 }, { type: 'shipping' }),
    '100% off on shipping'
  );
});

test('a multi-buy target says how many of how many', () => {
  assert.equal(
    describeDiscount(
      { type: 'relative', permyriad: 10000 },
      { type: 'multiBuyLineItems', triggerQuantity: 2, discountedQuantity: 1 }
    ),
    '100% off on 1 of every 2'
  );
});

test('a total-price target is distinguished from line items', () => {
  assert.equal(
    describeDiscount({ type: 'relative', permyriad: 2000 }, { type: 'totalPrice' }),
    '20% off on the order total'
  );
});

test('an absolute amount is rendered as money', () => {
  assert.equal(
    describeDiscount({
      type: 'absolute',
      money: [{ centAmount: 500, currencyCode: 'EUR', fractionDigits: 2 }],
    }),
    '5.00 EUR off'
  );
});

test('a product discount has no target and is described by value alone', () => {
  assert.equal(describeDiscount({ type: 'relative', permyriad: 4000 }, undefined), '40% off');
});

test('a gift line item is named rather than shown as a percentage', () => {
  assert.equal(describeDiscount({ type: 'giftLineItem' }, { type: 'lineItems' }), 'free gift');
});

test('an unknown target type falls back to the value alone', () => {
  assert.equal(
    describeDiscount({ type: 'relative', permyriad: 1000 }, { type: 'somethingNew' }),
    '10% off'
  );
});

test('a missing value describes as empty rather than throwing', () => {
  assert.equal(describeDiscount(null, { type: 'shipping' }), '');
});

test('money formats to the currency fraction digits', () => {
  assert.equal(money({ centAmount: 1234, currencyCode: 'USD', fractionDigits: 2 }), '12.34 USD');
});

test('pickName prefers en-US, then falls back', () => {
  assert.equal(pickName({ name: { 'en-US': 'A', de: 'B' } }), 'A');
  assert.equal(pickName({ name: { de: 'B' } }), 'B');
  assert.equal(pickName({ key: 'k' }), 'k');
});

test('a cart discount deep-links to its Merchant Center screen', () => {
  assert.equal(
    mcEditPath('stage-project', 'carts', 'abc-123'),
    '/stage-project/discounts/carts/abc-123/general'
  );
});

test('a discount group has no editing screen, so it gets no link', () => {
  assert.equal(mcEditPath('stage-project', null, 'abc-123'), null);
});

test('a missing id or project key yields no link rather than a broken one', () => {
  assert.equal(mcEditPath('stage-project', 'carts', undefined), null);
  assert.equal(mcEditPath(undefined, 'carts', 'abc-123'), null);
});
