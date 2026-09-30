/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */

/**
 * Browser harness for the real table and report components.
 *
 * The app itself renders inside an authenticated Merchant Center session, which
 * is impractical to drive headlessly. This page mounts the ACTUAL
 * `DiscountTable` and `DeployReport` — not a copy of their markup — against
 * fixture payloads shaped like the API's, so what is verified here is the
 * component that ships. Both take plain props, which is what makes that
 * possible; `DeployScreen` is excluded because it reads the Merchant Center
 * application context.
 *
 * Build and open:
 *   npm run harness
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import DiscountTable from '../../src/components/deploy/discount-table';
import DeployReport from '../../src/components/deploy/deploy-report';
import {
  emptySelection,
  type DiscountRow,
  type PrepareResponse,
  type Selection,
  type SelectionKey,
} from '../../src/components/deploy/types';

const rows: Record<string, DiscountRow[]> = {
  cartDiscounts: [
    {
      type: 'cart-discount',
      key: 'FreeShip100',
      name: 'Free Shipping when you spend 100 GBP',
      isActive: true,
      value: '100% off on shipping',
      deployable: true,
      existsInTarget: true,
      id: 'cd-1',
      editPath: '/stage-project/discounts/carts/cd-1/general',
    },
    {
      type: 'cart-discount',
      key: 'HomeDecor10Pct',
      name: '10% Off Home Decor',
      isActive: true,
      value: '10% off',
      deployable: true,
      existsInTarget: false,
      id: 'cd-2',
      editPath: '/stage-project/discounts/carts/cd-2/general',
    },
    {
      type: 'cart-discount',
      key: null,
      name: 'Legacy promo with no key',
      isActive: false,
      value: '5% off',
      deployable: false,
      existsInTarget: null,
    },
  ],
  discountGroups: [
    {
      type: 'discount-group',
      key: 'seasonal-promos',
      name: 'Seasonal Promos',
      isActive: true,
      value: '',
      deployable: true,
      existsInTarget: false,
      id: 'dg-1',
      editPath: null, // no Merchant Center screen for discount groups
    },
  ],
  discountCodes: [
    {
      type: 'discount-code',
      key: 'SPRING20',
      code: 'SPRING20',
      name: 'Spring 20',
      isActive: true,
      value: '',
      deployable: true,
      existsInTarget: false,
      id: 'dc-1',
      editPath: '/stage-project/discounts/codes/dc-1/general',
    },
  ],
};

const prepareWithBlocker: PrepareResponse = {
  selection: emptySelection(),
  added: [
    {
      selectionKey: 'cartDiscounts',
      key: 'SpringSale20',
      reason: 'required by discount code "SPRING20"',
    },
    {
      selectionKey: 'discountGroups',
      key: 'seasonal-promos',
      reason: 'required by cart discount "SpringSale20"',
    },
  ],
  warnings: [
    {
      kind: 'id-in-predicate',
      resource: 'cart-discount "HomeDecor10Pct"',
      detail:
        'its predicate embeds the id of category "home-decor", which means nothing in ' +
        "production-project. The deploy rewrites it to that project's id for the same key, " +
        'but authoring the predicate with categories.key would remove the translation entirely.',
    },
  ],
  idReferences: [],
  blockers: [
    {
      kind: 'duplicate-code-in-target',
      resource: 'discount-code "BOGO"',
      detail:
        'production-project already has a discount code with code "BOGO" and no key at all, and code must be unique. Give that one the key "BOGO" so this becomes an update, or remove it.',
    },
  ],
  results: {
    dryRun: true,
    source: 'stage-project',
    target: 'production-project',
    order: [
      { type: 'discount-group', key: 'seasonal-promos', action: 'create' },
      { type: 'cart-discount', key: 'SpringSale20', action: 'create' },
      {
        type: 'cart-discount',
        key: 'HomeDecor10Pct',
        action: 'update',
        actions: ['changeValue', 'changeName', 'changeIsActive'],
      },
      { type: 'cart-discount', key: 'FreeShip100', action: 'noop' },
      {
        type: 'discount-code',
        key: 'BOGO',
        action: 'error',
        error: 'A discount code with code "BOGO" already exists.',
      },
    ],
    summary: { create: 2, update: 1, noop: 1, error: 1 },
  },
  summary: { create: 2, update: 1, noop: 1, error: 1 },
  source: 'stage-project',
  target: 'production-project',
};

const Harness = () => {
  const [selection, setSelection] = useState<Selection>(() => ({
    ...emptySelection(),
    cartDiscounts: ['HomeDecor10Pct'],
  }));

  const toggle = (k: SelectionKey, key: string) =>
    setSelection((s) => ({
      ...s,
      [k]: s[k].includes(key) ? s[k].filter((x) => x !== key) : [...s[k], key],
    }));
  const toggleAll = (k: SelectionKey, keys: string[], select: boolean) =>
    setSelection((s) => ({ ...s, [k]: select ? keys : [] }));

  return (
    <IntlProvider locale="en" messages={{}}>
      <div style={{ padding: 24, maxWidth: 1600, fontFamily: 'system-ui, sans-serif' }}>
        <h2 id="h-tables">Tables</h2>
        <section id="tables">
          <DiscountTable
            selectionKey="cartDiscounts"
            label="Cart discounts"
            rows={rows.cartDiscounts}
            selected={selection.cartDiscounts}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
          <DiscountTable
            selectionKey="discountGroups"
            label="Discount groups"
            rows={rows.discountGroups}
            selected={selection.discountGroups}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
          <DiscountTable
            selectionKey="discountCodes"
            label="Discount codes"
            rows={rows.discountCodes}
            selected={selection.discountCodes}
            onToggle={toggle}
            onToggleAll={toggleAll}
            showCode
          />
        </section>
        <div
          id="selected-count"
          data-count={selection.cartDiscounts.length + selection.discountCodes.length}
        >
          selected: {selection.cartDiscounts.length + selection.discountCodes.length}
        </div>

        <h2 id="h-report" style={{ marginTop: 32 }}>
          Report — dependencies, blockers, errors, diff
        </h2>
        <section id="report-main">
          <DeployReport data={prepareWithBlocker} applied={false} />
        </section>

        <h2 id="h-empty" style={{ marginTop: 32 }}>
          Report — nothing to do
        </h2>
        <section id="report-empty">
          <DeployReport
            data={{
              selection: emptySelection(),
              added: [],
              blockers: [],
              results: {
                dryRun: true,
                source: 'stage-project',
                target: 'production-project',
                order: [{ type: 'cart-discount', key: 'FreeShip100', action: 'noop' }],
                summary: { create: 0, update: 0, noop: 1, error: 0 },
              },
              summary: { create: 0, update: 0, noop: 1, error: 0 },
              source: 'stage-project',
              target: 'production-project',
            }}
            applied={false}
          />
        </section>
      </div>
    </IntlProvider>
  );
};

createRoot(document.getElementById('root') as Element).render(<Harness />);
