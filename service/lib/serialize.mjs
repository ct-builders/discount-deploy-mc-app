/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * serialize.mjs — read discounts out of the stage project as a portable bundle.
 *
 * Adapted from ct-builders/ct-release-manager (packages/release-deploy).
 *
 * A commercetools id means nothing in another project, so nothing id-shaped
 * survives serialization:
 *
 *  - Anything that is a reference (stores, discountGroup, a code's cartDiscounts)
 *    is emitted BY KEY. Resource drafts accept key-based ResourceIdentifiers, so
 *    those port directly and commercetools resolves them in the target.
 *
 *  - The hard case is ids embedded INSIDE predicate strings — `categories.id =
 *    "…uuid…"` — and inside a giftLineItem value. Those are opaque text to the
 *    API. For each discount every predicate is scanned for uuids, each uuid is
 *    resolved to {typeId, key} in the SOURCE project, and the result is stored as
 *    `referenceMap`. deploy.mjs then rewrites each uuid to the TARGET project's id
 *    for that same key. A uuid that cannot be resolved is recorded as
 *    `unresolved` so validation can refuse the deploy instead of writing a
 *    predicate that silently matches nothing.
 */
import { ENDPOINT_BY_TYPEID, UUID_RE, RESOURCE_TYPES } from './util.mjs';

// ---- id → key resolution (cached per client) ----
export async function keyForId(client, typeId, id) {
  const ck = `${typeId}:${id}`;
  if (client.__refKeyCache.has(ck)) return client.__refKeyCache.get(ck);
  const ep = ENDPOINT_BY_TYPEID[typeId];
  let key = null;
  if (ep) {
    const r = await client.get(`/${ep}/${id}`);
    if (r && r.key) key = r.key;
  }
  client.__refKeyCache.set(ck, key);
  return key;
}

// A uuid in a predicate carries no type, so probe the resource types a discount
// predicate can realistically reference, in rough order of likelihood.
// Ordered by how often a discount predicate references each kind. `type` is
// here for `custom.type.id`, and `product-discount` for `price.discount.id`;
// both are legal in a predicate and would otherwise resolve to nothing and
// block the deploy.
const PROBE = [
  'category',
  'product',
  'customer-group',
  'channel',
  'product-type',
  'state',
  'tax-category',
  'store',
  'type',
  'product-discount',
];
async function keyForUnknownId(client, id) {
  const ck = `?:${id}`;
  if (client.__refKeyCache.has(ck)) return client.__refKeyCache.get(ck);
  let found = null;
  for (const t of PROBE) {
    const key = await keyForId(client, t, id);
    if (key) {
      found = { typeId: t, key };
      break;
    }
  }
  client.__refKeyCache.set(ck, found);
  return found;
}

// Map every uuid appearing in `predicates` (plus any platform-expanded
// `references`) to {typeId, key}. The `references` array, when the platform
// supplies it, gives the typeId outright and saves the probe.
export async function buildReferenceMap(client, predicates, references = []) {
  const hint = {};
  (references || []).forEach((r) => {
    if (r && r.id) hint[r.id] = r.typeId;
  });
  const ids = new Set();
  for (const p of predicates) {
    if (!p) continue;
    (String(p).match(UUID_RE) || []).forEach((u) => ids.add(u));
  }
  (references || []).forEach((r) => {
    if (r && r.id) ids.add(r.id);
  });

  const map = {};
  for (const id of ids) {
    let entry = null;
    if (hint[id]) {
      const key = await keyForId(client, hint[id], id);
      if (key) entry = { typeId: hint[id], key };
    }
    if (!entry) entry = await keyForUnknownId(client, id);
    map[id] = entry || { typeId: 'unknown', key: null, unresolved: true };
  }
  return map;
}

async function keyRef(client, typeId, ref) {
  if (!ref) return undefined;
  const key = ref.key || (ref.id ? await keyForId(client, typeId, ref.id) : null);
  return key ? { typeId, key } : { typeId, key: null, unresolved: true, id: ref.id };
}

// ---- per-resource serializers ----
export function serializeDiscountGroup(dg) {
  return {
    resourceType: 'discount-group',
    key: dg.key,
    name: dg.name,
    description: dg.description,
    sortOrder: dg.sortOrder,
    isActive: dg.isActive,
  };
}

async function serializeGiftLineItemValue(client, value) {
  const out = { ...value };
  if (value.product) out.product = await keyRef(client, 'product', value.product);
  if (value.supplyChannel) out.supplyChannel = await keyRef(client, 'channel', value.supplyChannel);
  if (value.distributionChannel)
    out.distributionChannel = await keyRef(client, 'channel', value.distributionChannel);
  return out;
}

export async function serializeCartDiscount(client, cd) {
  const referenceMap = await buildReferenceMap(
    client,
    [cd.cartPredicate, cd.target?.predicate],
    cd.references
  );
  const stores = await Promise.all((cd.stores || []).map((s) => keyRef(client, 'store', s)));
  const discountGroup = cd.discountGroup
    ? await keyRef(client, 'discount-group', cd.discountGroup)
    : undefined;
  const value =
    cd.value?.type === 'giftLineItem'
      ? await serializeGiftLineItemValue(client, cd.value)
      : cd.value;
  return {
    resourceType: 'cart-discount',
    key: cd.key,
    name: cd.name,
    description: cd.description,
    value,
    cartPredicate: cd.cartPredicate,
    target: cd.target,
    sortOrder: cd.sortOrder,
    stackingMode: cd.stackingMode,
    requiresDiscountCode: cd.requiresDiscountCode,
    isActive: cd.isActive,
    validFrom: cd.validFrom,
    validUntil: cd.validUntil,
    stores,
    discountGroup,
    referenceMap,
  };
}

export async function serializeProductDiscount(client, pd) {
  const referenceMap = await buildReferenceMap(client, [pd.predicate], pd.references);
  return {
    resourceType: 'product-discount',
    key: pd.key,
    name: pd.name,
    description: pd.description,
    value: pd.value,
    predicate: pd.predicate,
    sortOrder: pd.sortOrder,
    isActive: pd.isActive,
    validFrom: pd.validFrom,
    validUntil: pd.validUntil,
    referenceMap,
  };
}

export async function serializeDiscountCode(client, dc) {
  const referenceMap = await buildReferenceMap(client, [dc.cartPredicate], dc.references);
  const cartDiscounts = await Promise.all(
    (dc.cartDiscounts || []).map((r) => keyRef(client, 'cart-discount', r))
  );
  return {
    resourceType: 'discount-code',
    key: dc.key,
    code: dc.code,
    name: dc.name,
    description: dc.description,
    cartDiscounts,
    isActive: dc.isActive,
    maxApplications: dc.maxApplications,
    maxApplicationsPerCustomer: dc.maxApplicationsPerCustomer,
    cartPredicate: dc.cartPredicate,
    groups: dc.groups,
    validFrom: dc.validFrom,
    validUntil: dc.validUntil,
    referenceMap,
  };
}

const SERIALIZERS = {
  'discount-group': (client, o) => serializeDiscountGroup(o),
  'product-discount': serializeProductDiscount,
  'cart-discount': serializeCartDiscount,
  'discount-code': serializeDiscountCode,
};

// ---- top-level ----
// selection: { discountGroups, productDiscounts, cartDiscounts, discountCodes }
// each an array of keys, or '*' for every resource of that type.
async function resolveSelection(client, sel, endpoint) {
  if (!sel) return [];
  if (sel === '*' || (Array.isArray(sel) && sel.includes('*'))) return client.all(`/${endpoint}`);
  const out = [];
  for (const k of Array.isArray(sel) ? sel : [sel]) {
    const o = await client.byKey(endpoint, k);
    if (!o) throw new Error(`${endpoint} key "${k}" not found in ${client.pk}`);
    out.push(o);
  }
  return out;
}

export async function serializeBundle(client, selection) {
  const bundle = { sourceProject: client.pk };
  // RESOURCE_TYPES is in dependency order, and the bundle keeps that order so
  // deploy applies groups before the cart discounts that join them.
  for (const rt of RESOURCE_TYPES) {
    const raw = await resolveSelection(client, selection[rt.selectionKey], rt.endpoint);
    bundle[rt.selectionKey] = await Promise.all(raw.map((o) => SERIALIZERS[rt.type](client, o)));
  }
  return bundle;
}

/**
 * Every id a discount embeds in a predicate, and whether it can cross projects.
 *
 * A predicate is an opaque string to commercetools, so an id inside one is just
 * text. Deploying translates each id to the target's id for the same key
 * (deploy.mjs `rewritePredicate`), which works — but only as long as every id
 * resolves to a key here AND that key exists over there. This reports the whole
 * picture before anything is written, including the cases that DO translate,
 * because an id-based predicate is a standing liability: it depends on a lookup
 * succeeding every single deploy, where a key-based one is portable as written.
 *
 * `status` is one of:
 *   'translatable'         resolved to a key here; the deploy will rewrite it
 *   'unresolved-in-source' matches nothing in the source — no key to carry over
 *
 * Whether a translatable id's key actually exists in the target is a question
 * about the target, answered by deploy.mjs `validateAgainstTarget`.
 *
 * Predicate fields accept a `.key` form for most of these — `categories.key`,
 * `product.key`, `productType.key`, `custom.type.key`, `price.channel.key` —
 * and authoring with those removes the translation step entirely.
 */
export function collectIdReferences(bundle) {
  const found = [];
  const scan = (resourceType, key, fields) => {
    for (const [field, map] of Object.entries(fields)) {
      for (const [id, e] of Object.entries(map || {})) {
        found.push({
          resourceType,
          key,
          field,
          sourceId: id,
          typeId: e?.typeId ?? null,
          resolvedKey: e?.key ?? null,
          status: e?.key ? 'translatable' : 'unresolved-in-source',
          keyFormHint: KEY_FORM_HINT[e?.typeId] ?? null,
        });
      }
    }
  };
  for (const cd of bundle.cartDiscounts || [])
    scan('cart-discount', cd.key, { predicate: cd.referenceMap });
  for (const pd of bundle.productDiscounts || [])
    scan('product-discount', pd.key, { predicate: pd.referenceMap });
  for (const dc of bundle.discountCodes || [])
    scan('discount-code', dc.key, { cartPredicate: dc.referenceMap });
  return found;
}

// The key-based predicate field that replaces an id-based one, where the API
// offers a direct equivalent. Used only to make the warning actionable.
const KEY_FORM_HINT = {
  category: 'categories.key',
  product: 'product.key',
  'product-type': 'productType.key',
  channel: 'supplyChannel.key or price.channel.key',
  'customer-group': 'price.customerGroup.key',
  type: 'custom.type.key',
};

// Every reference the source could not resolve to a key — a hard stop for deploy.
export function collectUnresolved(bundle) {
  const problems = [];
  const scanMap = (rt, key, map) => {
    for (const [id, e] of Object.entries(map || {})) {
      if (e?.unresolved || !e?.key)
        problems.push({ resourceType: rt, key, kind: 'predicate-ref', sourceId: id });
    }
  };
  const scanRef = (rt, key, field, ref) => {
    if (ref && (ref.unresolved || ref.key == null))
      problems.push({ resourceType: rt, key, kind: field, sourceId: ref.id });
  };
  for (const cd of bundle.cartDiscounts || []) {
    scanMap('cart-discount', cd.key, cd.referenceMap);
    (cd.stores || []).forEach((s) => scanRef('cart-discount', cd.key, 'store', s));
    scanRef('cart-discount', cd.key, 'discountGroup', cd.discountGroup);
  }
  for (const pd of bundle.productDiscounts || [])
    scanMap('product-discount', pd.key, pd.referenceMap);
  for (const dc of bundle.discountCodes || []) {
    scanMap('discount-code', dc.key, dc.referenceMap);
    (dc.cartDiscounts || []).forEach((r) => scanRef('discount-code', dc.key, 'cartDiscount', r));
  }
  return problems;
}
