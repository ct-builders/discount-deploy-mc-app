/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * diff.mjs — what the UI asks for: the list, the dependency closure, the
 * prepared plan, and the apply.
 *
 * The prepared plan and the apply run the SAME comparison through deploy.mjs; the only
 * difference is the `dryRun` flag. That is deliberate — a prepared plan computed by a
 * separate code path is a prepared plan that can disagree with the deploy.
 */
import { RESOURCE_TYPES, pickName, describeDiscount, mcEditPath } from './util.mjs';
import { serializeBundle, collectUnresolved, collectIdReferences, keyForId } from './serialize.mjs';
import { deployBundle, validateAgainstTarget, collectConflicts } from './deploy.mjs';

const emptySelection = () => Object.fromEntries(RESOURCE_TYPES.map((r) => [r.selectionKey, []]));

/**
 * Every discount in the stage project, each flagged with whether its key already
 * exists in the target. Two list calls per resource type and no per-resource
 * round trips, so the table renders without waiting on a full diff; the precise
 * create/update/no-op verdict comes from `prepare` once a selection is made.
 */
export async function listDiscounts(stage, target) {
  const out = {};
  for (const rt of RESOURCE_TYPES) {
    const [mine, theirs] = await Promise.all([
      stage.all(`/${rt.endpoint}`),
      target.all(`/${rt.endpoint}`).catch(() => null),
    ]);
    const targetKeys = theirs === null ? null : new Set(theirs.map((o) => o.key).filter(Boolean));
    out[rt.selectionKey] = mine.map((o) => ({
      type: rt.type,
      key: o.key ?? null,
      // the source project's id, and the Merchant Center path that edits it
      id: o.id,
      editPath: mcEditPath(stage.pk, rt.mcSegment, o.id),
      name: pickName(o),
      code: o.code,
      isActive: o.isActive !== false,
      sortOrder: o.sortOrder,
      value: describeDiscount(o.value, o.target),
      requiresDiscountCode: o.requiresDiscountCode,
      validFrom: o.validFrom,
      validUntil: o.validUntil,
      // A resource with no key cannot be deployed: the whole upsert is keyed by
      // key, and commercetools will not let us invent one in the target.
      deployable: Boolean(o.key),
      existsInTarget: o.key && targetKeys ? targetKeys.has(o.key) : null,
    }));
  }
  return out;
}

const norm = (sel) => {
  const s = emptySelection();
  for (const rt of RESOURCE_TYPES) {
    const v = sel?.[rt.selectionKey];
    s[rt.selectionKey] =
      v === '*' ? '*' : Array.from(new Set(Array.isArray(v) ? v.filter(Boolean) : []));
  }
  return s;
};

/**
 * Add the things a selection depends on: a discount code needs its cart
 * discounts, and a cart discount needs its discount group. Both hops resolve
 * id → key in the source project, because that is how the references come back.
 *
 * Returns the expanded selection plus the list of what was pulled in, so the UI
 * can say "also deploying X" rather than surprising the user.
 */
export async function expandSelection(stage, selection) {
  const sel = norm(selection);
  const added = [];
  const add = (selectionKey, key, reason) => {
    if (!key || sel[selectionKey] === '*' || sel[selectionKey].includes(key)) return;
    sel[selectionKey].push(key);
    added.push({ selectionKey, key, reason });
  };

  if (Array.isArray(sel.discountCodes)) {
    for (const key of sel.discountCodes) {
      const dc = await stage.byKey('discount-codes', key);
      for (const r of dc?.cartDiscounts || []) {
        const cdKey = r.key || (await keyForId(stage, 'cart-discount', r.id));
        add('cartDiscounts', cdKey, `required by discount code "${key}"`);
      }
    }
  }
  if (Array.isArray(sel.cartDiscounts)) {
    // iterate over a copy: the loop above may have just appended to this list
    for (const key of [...sel.cartDiscounts]) {
      const cd = await stage.byKey('cart-discounts', key);
      if (cd?.discountGroup) {
        const dgKey =
          cd.discountGroup.key || (await keyForId(stage, 'discount-group', cd.discountGroup.id));
        add('discountGroups', dgKey, `required by cart discount "${key}"`);
      }
    }
  }
  return { selection: sel, added };
}

function countSelected(sel) {
  return RESOURCE_TYPES.reduce(
    (n, rt) => n + (sel[rt.selectionKey] === '*' ? 1 : sel[rt.selectionKey].length),
    0
  );
}

/**
 * Serialize the selection out of stage and report exactly what a deploy would
 * do, without writing anything.
 *
 * `blockers` is the question the UI actually needs answered: can this be
 * deployed? It is non-empty when a reference cannot be resolved in the source or
 * does not exist in the target — either of which would otherwise produce a
 * discount whose predicate silently matches nothing.
 */
export async function prepare(stage, target, selection, { autoDeps = true } = {}) {
  const { selection: sel, added } = autoDeps
    ? await expandSelection(stage, selection)
    : { selection: norm(selection), added: [] };

  if (!countSelected(sel)) {
    return {
      selection: sel,
      added,
      unresolved: [],
      missing: [],
      conflicts: [],
      idReferences: [],
      warnings: [],
      blockers: [],
      results: null,
      summary: null,
    };
  }

  const bundle = await serializeBundle(stage, sel);
  const unresolved = collectUnresolved(bundle);
  const missing = await validateAgainstTarget(target, bundle);
  const conflicts = await collectConflicts(target, bundle);
  const idReferences = collectIdReferences(bundle);
  const results = await deployBundle(target, bundle, { dryRun: true });

  const blockers = [
    ...unresolved.map((u) => ({
      kind: 'unresolved-in-source',
      resource: `${u.resourceType} "${u.key}"`,
      detail: `a reference in its ${u.kind} could not be resolved to a key in ${stage.pk} (source id ${u.sourceId})`,
    })),
    ...missing.map((m) => ({
      kind: m.reason,
      resource: `${m.resource} "${m.key}"`,
      detail: m.key
        ? `needs ${m.typeId} "${m.key}" (via ${m.field}), which does not exist in ${target.pk}`
        : `has an unresolved ${m.field} reference`,
    })),
    ...conflicts.map((c) => ({
      kind: c.reason,
      resource: `${c.resource} "${c.key}"`,
      detail:
        `${target.pk} already has a discount code with code "${c.value}"` +
        (c.conflictingKey ? ` under the key "${c.conflictingKey}"` : ' and no key at all') +
        `, and code must be unique. Give that one the key "${c.key}" so this becomes an update, or remove it.`,
    })),
  ];

  // An id that translates is not an error, but it is worth saying out loud: the
  // deploy depends on a lookup succeeding, where a key-based predicate would
  // not. Ids that do NOT translate are already blockers via `unresolved`.
  const warnings = idReferences
    .filter((r) => r.status === 'translatable')
    .map((r) => ({
      kind: 'id-in-predicate',
      resource: `${r.resourceType} "${r.key}"`,
      detail:
        `its ${r.field} embeds the id of ${r.typeId} "${r.resolvedKey}", which means nothing in ` +
        `${target.pk}. The deploy rewrites it to that project's id for the same key` +
        (r.keyFormHint
          ? `, but authoring the predicate with ${r.keyFormHint} would remove the translation entirely.`
          : '.'),
    }));

  return {
    selection: sel,
    added,
    unresolved,
    missing,
    conflicts,
    idReferences,
    warnings,
    blockers,
    results,
    summary: results.summary,
    source: stage.pk,
    target: target.pk,
  };
}

/**
 * Deploy for real. Runs the prepared plan first and refuses on any blocker, so a
 * partially-applied bundle is not a normal outcome.
 */
export async function apply(stage, target, selection, { autoDeps = true, force = false } = {}) {
  const pre = await prepare(stage, target, selection, { autoDeps });
  if (!countSelected(pre.selection)) {
    return { ...pre, applied: false, reason: 'nothing selected' };
  }
  if (pre.blockers.length && !force) {
    return { ...pre, applied: false, reason: 'blocked' };
  }
  const bundle = await serializeBundle(stage, pre.selection);
  const results = await deployBundle(target, bundle, { dryRun: false });
  return { ...pre, applied: true, results, summary: results.summary };
}
