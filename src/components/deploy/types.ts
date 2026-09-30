/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/** Mirrors the payloads in service/lib — see diff.mjs and deploy.mjs. */

export type SelectionKey =
  | 'discountGroups'
  | 'productDiscounts'
  | 'cartDiscounts'
  | 'discountCodes';

export type Selection = Record<SelectionKey, string[]>;

export type DiscountRow = {
  type: string;
  key: string | null;
  /** the source project's id */
  id?: string;
  /**
   * Merchant Center path that edits this discount in the source project, or
   * null when the resource has no editing screen (discount groups).
   */
  editPath?: string | null;
  name: string;
  code?: string;
  isActive: boolean;
  sortOrder?: string;
  value: string;
  requiresDiscountCode?: boolean;
  validFrom?: string;
  validUntil?: string;
  deployable: boolean;
  /** null when the target could not be listed at all. */
  existsInTarget: boolean | null;
};

export type ListResponse = {
  source: string;
  target: string;
  discounts: Record<SelectionKey, DiscountRow[]>;
};

export type ConfigResponse = {
  source: string;
  target: string;
  resourceTypes: { type: string; selectionKey: SelectionKey; label: string }[];
};

export type ResultAction = 'create' | 'update' | 'noop' | 'error';

export type ResultRow = {
  type: string;
  key: string;
  action: ResultAction;
  actions?: string[];
  error?: string;
  status?: number;
};

export type Blocker = { kind: string; resource: string; detail: string };

/** Same shape as a blocker, but the deploy still proceeds. */
export type Warning = Blocker;

export type IdReference = {
  resourceType: string;
  key: string;
  field: string;
  sourceId: string;
  typeId: string | null;
  resolvedKey: string | null;
  status: 'translatable' | 'unresolved-in-source';
  keyFormHint: string | null;
};

export type AddedDep = { selectionKey: SelectionKey; key: string; reason: string };

export type PrepareResponse = {
  selection: Selection;
  added: AddedDep[];
  blockers: Blocker[];
  warnings: Warning[];
  idReferences: IdReference[];
  results: {
    dryRun: boolean;
    target: string;
    source: string;
    order: ResultRow[];
    summary: Record<ResultAction, number>;
  } | null;
  summary: Record<ResultAction, number> | null;
  source?: string;
  target?: string;
  /** present on the deploy response */
  applied?: boolean;
  reason?: string;
};

export const SELECTION_ORDER: SelectionKey[] = [
  'discountGroups',
  'productDiscounts',
  'cartDiscounts',
  'discountCodes',
];

export const LABELS: Record<SelectionKey, string> = {
  discountGroups: 'Discount groups',
  productDiscounts: 'Product discounts',
  cartDiscounts: 'Cart discounts',
  discountCodes: 'Discount codes',
};

export const emptySelection = (): Selection => ({
  discountGroups: [],
  productDiscounts: [],
  cartDiscounts: [],
  discountCodes: [],
});

export const countSelection = (s: Selection) =>
  SELECTION_ORDER.reduce((n, k) => n + s[k].length, 0);
