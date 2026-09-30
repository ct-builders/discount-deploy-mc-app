/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * deploy.mjs — validate and upsert a discount bundle into the target project.
 *
 * Adapted from ct-builders/release-manager (packages/release-deploy).
 *
 * Idempotent, by key. For each discount: create it if the key is absent,
 * otherwise diff field by field and send only the update actions for what
 * actually changed. A discount already identical in the target reports `noop`
 * and is left alone, so deploying twice does nothing the second time — which is
 * also what makes `dryRun` a truthful plan: the same comparison runs, it just
 * reports the actions instead of sending them.
 */
import { ENDPOINT_BY_TYPEID, RESOURCE_TYPES, stableStringify } from './util.mjs';

const cleanRef = (r) => (r && r.key ? { typeId: r.typeId, key: r.key } : undefined);
const cleanRefs = (arr) => (arr || []).map(cleanRef).filter(Boolean);
const changed = (a, b) => stableStringify(a ?? null) !== stableStringify(b ?? null);
const dropUndef = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const errMsg = (r) => r.body?.message || JSON.stringify(r.body?.errors || r.body).slice(0, 400);

// target id ← key (cached)
async function targetId(target, typeId, key) {
  const ck = `tid:${typeId}:${key}`;
  if (target.__refKeyCache.has(ck)) return target.__refKeyCache.get(ck);
  const ep = ENDPOINT_BY_TYPEID[typeId];
  const o = ep ? await target.byKey(ep, key) : null;
  const id = o?.id || null;
  target.__refKeyCache.set(ck, id);
  return id;
}
// target key ← id (cached) — an existing resource's refs come back id-based, so
// diffing them against a key-based draft needs the reverse lookup.
async function targetKeyOfId(target, typeId, id) {
  if (!id) return null;
  const ck = `tk:${typeId}:${id}`;
  if (target.__refKeyCache.has(ck)) return target.__refKeyCache.get(ck);
  const ep = ENDPOINT_BY_TYPEID[typeId];
  const o = ep ? await target.get(`/${ep}/${id}`) : null;
  const key = o?.key || null;
  target.__refKeyCache.set(ck, key);
  return key;
}

/**
 * Swap every source uuid in a predicate for the target project's id for the same
 * key. A predicate written against keys rather than ids needs no rewriting and
 * passes through untouched.
 */
export async function rewritePredicate(target, predicate, referenceMap) {
  if (!predicate || !referenceMap) return predicate;
  let out = predicate;
  for (const [srcId, e] of Object.entries(referenceMap)) {
    if (!e?.key) continue;
    const tid = await targetId(target, e.typeId, e.key);
    if (tid && tid !== srcId) out = out.split(srcId).join(tid);
  }
  return out;
}

/**
 * Every key-based reference the bundle needs, checked against the target before
 * anything is written. A reference satisfied by this same deploy (a code pointing
 * at a cart discount also being deployed) counts as present.
 */
export async function validateAgainstTarget(target, bundle) {
  const missing = [];
  const inBundle = {
    'discount-group': new Set((bundle.discountGroups || []).map((d) => d.key)),
    'cart-discount': new Set((bundle.cartDiscounts || []).map((d) => d.key)),
  };
  const check = async (typeId, key, ctx) => {
    if (!key) {
      missing.push({ ...ctx, typeId, key: null, reason: 'unresolved-in-source' });
      return;
    }
    if (inBundle[typeId]?.has(key)) return; // created by this deploy
    const ep = ENDPOINT_BY_TYPEID[typeId];
    const o = ep ? await target.byKey(ep, key) : null;
    if (!o) missing.push({ ...ctx, typeId, key, reason: 'not-in-target' });
  };

  for (const cd of bundle.cartDiscounts || []) {
    for (const s of cd.stores || [])
      await check('store', s.key, { resource: 'cart-discount', key: cd.key, field: 'store' });
    if (cd.discountGroup)
      await check('discount-group', cd.discountGroup.key, {
        resource: 'cart-discount',
        key: cd.key,
        field: 'discountGroup',
      });
    for (const e of Object.values(cd.referenceMap || {})) {
      if (e?.key || e?.unresolved)
        await check(e.typeId, e.key, {
          resource: 'cart-discount',
          key: cd.key,
          field: 'predicate',
        });
    }
  }
  for (const pd of bundle.productDiscounts || []) {
    for (const e of Object.values(pd.referenceMap || {})) {
      if (e?.key || e?.unresolved)
        await check(e.typeId, e.key, {
          resource: 'product-discount',
          key: pd.key,
          field: 'predicate',
        });
    }
  }
  for (const dc of bundle.discountCodes || []) {
    for (const r of dc.cartDiscounts || [])
      await check('cart-discount', r.key, {
        resource: 'discount-code',
        key: dc.key,
        field: 'cartDiscount',
      });
    for (const e of Object.values(dc.referenceMap || {})) {
      if (e?.key || e?.unresolved)
        await check(e.typeId, e.key, {
          resource: 'discount-code',
          key: dc.key,
          field: 'predicate',
        });
    }
  }
  return missing;
}

/**
 * Unique-field collisions that key-based upsert cannot see.
 *
 * Everything here is matched by `key`, but a discount code also has `code`,
 * which is unique per project independently of the key. A code authored in the
 * source with a key, whose target counterpart was created without one, looks
 * absent to a key lookup — so the upsert would create it and commercetools would
 * reject the write on the duplicate `code`. That is worth catching in the
 * prepared plan rather than halfway through a deploy.
 */
export async function collectConflicts(target, bundle) {
  const conflicts = [];
  for (const dc of bundle.discountCodes || []) {
    if (!dc.code) continue;
    const existingByKey = await target.byKey('discount-codes', dc.key);
    if (existingByKey) continue; // an update, not a create — no collision possible
    const q = await target.get(
      `/discount-codes?where=${encodeURIComponent(`code="${dc.code}"`)}&limit=1`
    );
    const clash = q?.results?.[0];
    if (clash) {
      conflicts.push({
        resource: 'discount-code',
        key: dc.key,
        field: 'code',
        value: dc.code,
        conflictingKey: clash.key ?? null,
        reason: 'duplicate-code-in-target',
      });
    }
  }
  return conflicts;
}

// ---- generic upsert executor ----
async function upsert(target, endpoint, key, buildDraft, buildActions, dryRun) {
  const existing = await target.byKey(endpoint, key);
  if (!existing) {
    const draft = await buildDraft();
    if (dryRun) return { key, action: 'create' };
    const r = await target.post(`/${endpoint}`, draft);
    return r.ok
      ? { key, action: 'create', status: r.status }
      : { key, action: 'error', status: r.status, error: errMsg(r) };
  }
  const actions = await buildActions(existing);
  if (!actions.length) return { key, action: 'noop' };
  if (dryRun) return { key, action: 'update', actions: actions.map((a) => a.action) };
  const r = await target.post(`/${endpoint}/key=${encodeURIComponent(key)}`, {
    version: existing.version,
    actions,
  });
  return r.ok
    ? { key, action: 'update', status: r.status, actions: actions.map((a) => a.action) }
    : {
        key,
        action: 'error',
        status: r.status,
        error: errMsg(r),
        attempted: actions.map((a) => a.action),
      };
}

const validity = (want, ex) =>
  (want.validFrom || null) !== (ex.validFrom || null) ||
  (want.validUntil || null) !== (ex.validUntil || null);

// ---- discount group ----
async function upsertDiscountGroup(target, dg, dryRun) {
  return upsert(
    target,
    'discount-groups',
    dg.key,
    () =>
      dropUndef({
        key: dg.key,
        name: dg.name,
        description: dg.description,
        sortOrder: dg.sortOrder,
        isActive: dg.isActive,
      }),
    (ex) => {
      const a = [];
      if (changed(dg.name, ex.name)) a.push({ action: 'setName', name: dg.name });
      if (changed(dg.description, ex.description))
        a.push({ action: 'setDescription', description: dg.description });
      if (dg.sortOrder !== ex.sortOrder)
        a.push({ action: 'setSortOrder', sortOrder: dg.sortOrder });
      if (dg.isActive !== ex.isActive) a.push({ action: 'setIsActive', isActive: dg.isActive });
      return a;
    },
    dryRun
  );
}

function buildCartValue(value) {
  if (value?.type === 'giftLineItem') {
    return dropUndef({
      ...value,
      product: cleanRef(value.product),
      supplyChannel: cleanRef(value.supplyChannel),
      distributionChannel: cleanRef(value.distributionChannel),
    });
  }
  return value;
}

// ---- cart discount ----
async function upsertCartDiscount(target, cd, dryRun) {
  const predicate = await rewritePredicate(target, cd.cartPredicate, cd.referenceMap);
  const tgt = cd.target
    ? {
        ...cd.target,
        predicate: await rewritePredicate(target, cd.target.predicate, cd.referenceMap),
      }
    : undefined;
  return upsert(
    target,
    'cart-discounts',
    cd.key,
    () =>
      dropUndef({
        key: cd.key,
        name: cd.name,
        description: cd.description,
        value: buildCartValue(cd.value),
        cartPredicate: predicate,
        target: tgt,
        sortOrder: cd.sortOrder,
        stackingMode: cd.stackingMode,
        requiresDiscountCode: cd.requiresDiscountCode,
        isActive: cd.isActive,
        validFrom: cd.validFrom,
        validUntil: cd.validUntil,
        stores: cleanRefs(cd.stores),
        discountGroup: cleanRef(cd.discountGroup),
      }),
    async (ex) => {
      const a = [];
      if (changed(buildCartValue(cd.value), ex.value))
        a.push({ action: 'changeValue', value: buildCartValue(cd.value) });
      if (predicate !== ex.cartPredicate)
        a.push({ action: 'changeCartPredicate', cartPredicate: predicate });
      if (tgt && changed(tgt, ex.target)) a.push({ action: 'changeTarget', target: tgt });
      if (changed(cd.name, ex.name)) a.push({ action: 'changeName', name: cd.name });
      if (changed(cd.description, ex.description))
        a.push({ action: 'setDescription', description: cd.description });
      if (cd.stackingMode !== ex.stackingMode)
        a.push({ action: 'changeStackingMode', stackingMode: cd.stackingMode });
      if (cd.requiresDiscountCode !== ex.requiresDiscountCode)
        a.push({
          action: 'changeRequiresDiscountCode',
          requiresDiscountCode: cd.requiresDiscountCode,
        });
      if (cd.isActive !== ex.isActive) a.push({ action: 'changeIsActive', isActive: cd.isActive });
      if (cd.sortOrder !== ex.sortOrder)
        a.push({ action: 'changeSortOrder', sortOrder: cd.sortOrder });
      if (validity(cd, ex))
        a.push(
          dropUndef({
            action: 'setValidFromAndUntil',
            validFrom: cd.validFrom,
            validUntil: cd.validUntil,
          })
        );
      const wantStores = (cd.stores || [])
        .map((s) => s.key)
        .filter(Boolean)
        .sort();
      const haveStores = (ex.stores || [])
        .map((s) => s.key)
        .filter(Boolean)
        .sort();
      if (changed(wantStores, haveStores))
        a.push({ action: 'setStores', stores: cleanRefs(cd.stores) });
      // discountGroup comes back id-based on the existing resource
      const wantG = cd.discountGroup?.key || null;
      const haveG = ex.discountGroup
        ? await targetKeyOfId(target, 'discount-group', ex.discountGroup.id)
        : null;
      if (wantG !== haveG)
        a.push(
          dropUndef({ action: 'setDiscountGroup', discountGroup: cleanRef(cd.discountGroup) })
        );
      return a;
    },
    dryRun
  );
}

// ---- product discount ----
async function upsertProductDiscount(target, pd, dryRun) {
  const predicate = await rewritePredicate(target, pd.predicate, pd.referenceMap);
  return upsert(
    target,
    'product-discounts',
    pd.key,
    () =>
      dropUndef({
        key: pd.key,
        name: pd.name,
        description: pd.description,
        value: pd.value,
        predicate,
        sortOrder: pd.sortOrder,
        isActive: pd.isActive,
        validFrom: pd.validFrom,
        validUntil: pd.validUntil,
      }),
    (ex) => {
      const a = [];
      if (changed(pd.value, ex.value)) a.push({ action: 'changeValue', value: pd.value });
      if (predicate !== ex.predicate) a.push({ action: 'changePredicate', predicate });
      if (changed(pd.name, ex.name)) a.push({ action: 'changeName', name: pd.name });
      if (changed(pd.description, ex.description))
        a.push({ action: 'setDescription', description: pd.description });
      if (pd.isActive !== ex.isActive) a.push({ action: 'changeIsActive', isActive: pd.isActive });
      if (pd.sortOrder !== ex.sortOrder)
        a.push({ action: 'changeSortOrder', sortOrder: pd.sortOrder });
      if (validity(pd, ex))
        a.push(
          dropUndef({
            action: 'setValidFromAndUntil',
            validFrom: pd.validFrom,
            validUntil: pd.validUntil,
          })
        );
      return a;
    },
    dryRun
  );
}

// ---- discount code ----
async function upsertDiscountCode(target, dc, dryRun) {
  const predicate = await rewritePredicate(target, dc.cartPredicate, dc.referenceMap);
  return upsert(
    target,
    'discount-codes',
    dc.key,
    () =>
      dropUndef({
        key: dc.key,
        code: dc.code,
        name: dc.name,
        description: dc.description,
        cartDiscounts: cleanRefs(dc.cartDiscounts),
        isActive: dc.isActive,
        maxApplications: dc.maxApplications,
        maxApplicationsPerCustomer: dc.maxApplicationsPerCustomer,
        cartPredicate: predicate,
        groups: dc.groups,
        validFrom: dc.validFrom,
        validUntil: dc.validUntil,
      }),
    async (ex) => {
      const a = [];
      const wantCd = (dc.cartDiscounts || [])
        .map((r) => r.key)
        .filter(Boolean)
        .sort();
      const haveCd = [];
      for (const r of ex.cartDiscounts || [])
        haveCd.push(r.key || (await targetKeyOfId(target, 'cart-discount', r.id)));
      if (changed(wantCd, haveCd.filter(Boolean).sort()))
        a.push({ action: 'changeCartDiscounts', cartDiscounts: cleanRefs(dc.cartDiscounts) });
      if (dc.isActive !== ex.isActive) a.push({ action: 'changeIsActive', isActive: dc.isActive });
      if (changed(dc.name, ex.name)) a.push({ action: 'setName', name: dc.name });
      if (changed(dc.description, ex.description))
        a.push({ action: 'setDescription', description: dc.description });
      if ((dc.maxApplications ?? null) !== (ex.maxApplications ?? null))
        a.push(dropUndef({ action: 'setMaxApplications', maxApplications: dc.maxApplications }));
      if ((dc.maxApplicationsPerCustomer ?? null) !== (ex.maxApplicationsPerCustomer ?? null))
        a.push(
          dropUndef({
            action: 'setMaxApplicationsPerCustomer',
            maxApplicationsPerCustomer: dc.maxApplicationsPerCustomer,
          })
        );
      if (changed((dc.groups || []).slice().sort(), (ex.groups || []).slice().sort()))
        a.push({ action: 'changeGroups', groups: dc.groups || [] });
      if ((predicate || null) !== (ex.cartPredicate || null))
        a.push(dropUndef({ action: 'setCartPredicate', cartPredicate: predicate }));
      if (validity(dc, ex))
        a.push(
          dropUndef({
            action: 'setValidFromAndUntil',
            validFrom: dc.validFrom,
            validUntil: dc.validUntil,
          })
        );
      return a;
    },
    dryRun
  );
}

const UPSERTS = {
  'discount-group': upsertDiscountGroup,
  'product-discount': upsertProductDiscount,
  'cart-discount': upsertCartDiscount,
  'discount-code': upsertDiscountCode,
};

function summarize(order) {
  const s = { create: 0, update: 0, noop: 0, error: 0 };
  for (const r of order) s[r.action] = (s[r.action] || 0) + 1;
  return s;
}

/**
 * Apply `bundle` to `target`. With `dryRun` (the default) nothing is written and
 * the result is the prepared plan the UI shows. Resource types are applied in
 * RESOURCE_TYPES order so dependencies land before the things referencing them.
 */
export async function deployBundle(target, bundle, { dryRun = true } = {}) {
  const results = { dryRun, target: target.pk, source: bundle.sourceProject, order: [] };
  for (const rt of RESOURCE_TYPES) {
    for (const item of bundle[rt.selectionKey] || []) {
      results.order.push({ type: rt.type, ...(await UPSERTS[rt.type](target, item, dryRun)) });
    }
  }
  results.summary = summarize(results.order);
  return results;
}
