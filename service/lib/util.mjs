/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * util.mjs — shared helpers.
 *
 * Adapted from ct-builders/ct-release-manager (packages/release-deploy), narrowed to
 * the four discount resources.
 */

// typeId → REST collection endpoint, for id↔key resolution and upserts.
export const ENDPOINT_BY_TYPEID = {
  category: 'categories',
  product: 'products',
  'product-type': 'product-types',
  'customer-group': 'customer-groups',
  channel: 'channels',
  'tax-category': 'tax-categories',
  state: 'states',
  store: 'stores',
  'discount-group': 'discount-groups',
  'cart-discount': 'cart-discounts',
  'product-discount': 'product-discounts',
  'discount-code': 'discount-codes',
  // `type` is reachable from a predicate via `custom.type.id`; without it the
  // probe in serialize.mjs has nowhere to look the id up and the reference
  // resolves to nothing, which blocks the deploy.
  type: 'types',
};

// The four resources this tool deploys, in dependency order: a discount group
// must exist before a cart discount joins it, and a cart discount before a code
// points at it. Every list/diff/deploy walks this array, so adding a resource
// type here is the single place that order is declared.
//
// `mcSegment` is the Merchant Center's own route segment for the resource, used
// to deep-link a row to its editing screen. Discount groups have no such screen
// — that path redirects to the cart-discount list — so the segment is null and
// those rows are deliberately not linked.
export const RESOURCE_TYPES = [
  {
    type: 'discount-group',
    endpoint: 'discount-groups',
    selectionKey: 'discountGroups',
    label: 'Discount group',
    mcSegment: null,
  },
  {
    type: 'product-discount',
    endpoint: 'product-discounts',
    selectionKey: 'productDiscounts',
    label: 'Product discount',
    mcSegment: 'products',
  },
  {
    type: 'cart-discount',
    endpoint: 'cart-discounts',
    selectionKey: 'cartDiscounts',
    label: 'Cart discount',
    mcSegment: 'carts',
  },
  {
    type: 'discount-code',
    endpoint: 'discount-codes',
    selectionKey: 'discountCodes',
    label: 'Discount code',
    mcSegment: 'codes',
  },
];

/**
 * The Merchant Center path that edits a discount, or null when the resource has
 * no editing screen.
 *
 * Built from the SOURCE project key rather than whatever project the application
 * happens to be open in, so the link lands on the discount the row actually
 * describes.
 */
export function mcEditPath(projectKey, mcSegment, id) {
  if (!projectKey || !mcSegment || !id) return null;
  return `/${projectKey}/discounts/${mcSegment}/${id}/general`;
}

export const SELECTION_KEYS = RESOURCE_TYPES.map((r) => r.selectionKey);

// commercetools UUID shape — ids embedded inside predicate strings.
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

export const LANGS = ['en-US', 'en', 'de-DE', 'es-MX', 'pt-BR'];
export function pickName(o) {
  const n = o?.name;
  if (!n) return o?.key || o?.id || 'unnamed';
  if (typeof n === 'string') return n;
  for (const l of LANGS) if (n[l]) return n[l];
  return Object.values(n)[0] || o.key || o.id;
}

export function money(v) {
  if (!v) return '';
  const amt = (v.centAmount ?? 0) / 10 ** (v.fractionDigits ?? 2);
  return `${amt.toFixed(v.fractionDigits ?? 2)} ${v.currencyCode || ''}`.trim();
}

/**
 * A one-line summary of what a discount actually does, for the UI's list.
 *
 * The target matters as much as the value: a cart discount of 100% against
 * `shipping` is free shipping, not a free order, and a merchandiser scanning
 * this column should not have to open the discount to tell those apart.
 */
export function describeDiscount(value, target) {
  if (!value) return '';
  let amount;
  switch (value.type) {
    case 'relative':
      amount = `${(value.permyriad ?? 0) / 100}% off`;
      break;
    case 'absolute':
      amount = `${(value.money || []).map(money).join(', ')} off`;
      break;
    case 'fixed':
      amount = `fixed ${(value.money || []).map(money).join(', ')}`;
      break;
    case 'externalPrice':
      return 'external price';
    case 'giftLineItem':
      return 'free gift';
    default:
      amount = value.type || '';
  }
  return amount + describeTarget(target);
}

function describeTarget(target) {
  if (!target) return ''; // product discounts have no target
  switch (target.type) {
    case 'shipping':
      return ' on shipping';
    case 'totalPrice':
      return ' on the order total';
    case 'multiBuyLineItems':
    case 'multiBuyCustomLineItems':
      return target.triggerQuantity
        ? ` on ${target.discountedQuantity ?? 1} of every ${target.triggerQuantity}`
        : ' on multi-buy items';
    case 'pattern':
      return ' on matching sets';
    default:
      return ''; // lineItems / customLineItems — the plain case
  }
}

// stable JSON stringify (sorted keys) — for content comparison
export function stableStringify(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted = {};
      for (const k of Object.keys(v).sort()) sorted[k] = v[k];
      return sorted;
    }
    return v;
  });
}
