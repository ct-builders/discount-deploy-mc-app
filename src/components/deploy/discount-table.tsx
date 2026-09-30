/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import CheckboxInput from '@commercetools-uikit/checkbox-input';
import Text from '@commercetools-uikit/text';
import type { DiscountRow, SelectionKey } from './types';

/**
 * One resource type's discounts, as a selectable table.
 *
 * Ruled cells and a shaded header row, because this is read as a grid: the
 * status column is the one a merchandiser scans down before deciding what to
 * send.
 */

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid #c9d1d9',
  background: '#f0f2f5',
  color: '#0c0d0e',
  fontWeight: 600,
  fontSize: '0.87rem',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #e7e9ee',
  fontSize: '0.9rem',
  verticalAlign: 'middle',
};

const pill = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 10,
  background: bg,
  color: fg,
  fontSize: '0.78rem',
  fontWeight: 600,
  whiteSpace: 'nowrap',
});

/**
 * The key, deep-linked to the discount's own Merchant Center screen when it has
 * one. Opens in a new tab on purpose: navigating away would discard the
 * selection and any diff already on screen.
 *
 * Rows without an `editPath` — discount groups, which have no Merchant Center
 * editing screen — stay plain text rather than offering a link that would land
 * somewhere else.
 */
const KeyCell = ({ row }: { row: DiscountRow }) => {
  if (!row.key) return <span style={{ color: '#8b95a1' }}>no key</span>;
  // NOT a <>…</> fragment: mc-scripts' Babel compiles the shorthand to
  // React.Fragment, and this file does not import React, so it throws
  // "React is not defined" at render. esbuild's automatic JSX runtime (which the
  // test harness uses) does not, so this only fails in the built app.
  if (!row.editPath) return <span>{row.key}</span>;
  return (
    <a
      href={row.editPath}
      target="_blank"
      rel="noreferrer"
      title={`Edit ${row.name} in the Merchant Center`}
      style={{ color: '#1a4fa0', textDecoration: 'underline' }}
      // the row's checkbox is the click target for selection; this link is not
      onClick={(e) => e.stopPropagation()}
    >
      {row.key}
    </a>
  );
};
KeyCell.displayName = 'KeyCell';

const StatusPill = ({ row }: { row: DiscountRow }) => {
  if (row.existsInTarget === null) return <span style={pill('#eceff3', '#4a5561')}>unknown</span>;
  return row.existsInTarget ? (
    <span style={pill('#eceff3', '#4a5561')}>In production</span>
  ) : (
    <span style={pill('#e3f2e5', '#186a3b')}>New</span>
  );
};

type Props = {
  selectionKey: SelectionKey;
  label: string;
  rows: DiscountRow[];
  selected: string[];
  onToggle: (selectionKey: SelectionKey, key: string) => void;
  onToggleAll: (selectionKey: SelectionKey, keys: string[], select: boolean) => void;
  showCode?: boolean;
};

const DiscountTable = ({
  selectionKey,
  label,
  rows,
  selected,
  onToggle,
  onToggleAll,
  showCode,
}: Props) => {
  const deployable = rows.filter((r) => r.deployable && r.key).map((r) => r.key as string);
  const allSelected = deployable.length > 0 && deployable.every((k) => selected.includes(k));

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <Text.Subheadline as="h4">{label}</Text.Subheadline>
        <Text.Detail tone="secondary">
          {rows.length === 0
            ? 'none in the source project'
            : `${rows.length} in the source project, ${selected.length} selected`}
        </Text.Detail>
      </div>

      {rows.length === 0 ? null : (
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #c9d1d9' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 40 }}>
                <CheckboxInput
                  isChecked={allSelected}
                  isDisabled={deployable.length === 0}
                  onChange={() => onToggleAll(selectionKey, deployable, !allSelected)}
                  aria-label={`Select all ${label}`}
                />
              </th>
              <th style={th}>Key</th>
              {showCode ? <th style={th}>Code</th> : null}
              <th style={th}>Name</th>
              <th style={th}>Discount</th>
              <th style={th}>Active</th>
              <th style={th}>In production</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const key = row.key;
              const isSelected = Boolean(key && selected.includes(key));
              return (
                <tr
                  key={key ?? `nokey-${i}`}
                  style={{ background: isSelected ? '#f5f9ff' : 'transparent' }}
                >
                  <td style={td}>
                    <CheckboxInput
                      isChecked={isSelected}
                      isDisabled={!row.deployable}
                      onChange={() => key && onToggle(selectionKey, key)}
                      aria-label={`Select ${row.name}`}
                    />
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.84rem' }}>
                    <KeyCell row={row} />
                  </td>
                  {showCode ? (
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.84rem' }}>
                      {row.code}
                    </td>
                  ) : null}
                  <td style={td}>
                    {row.name}
                    {row.deployable ? null : (
                      <div style={{ color: '#a8500f', fontSize: '0.78rem', marginTop: 2 }}>
                        Cannot be deployed: it has no key, and the deploy matches resources by key.
                        Give it one in the source project first.
                      </div>
                    )}
                  </td>
                  <td style={td}>{row.value}</td>
                  <td style={td}>
                    {row.isActive ? (
                      <span style={pill('#e3f2e5', '#186a3b')}>Active</span>
                    ) : (
                      <span style={pill('#f3ecd9', '#7a5a12')}>Inactive</span>
                    )}
                  </td>
                  <td style={td}>
                    <StatusPill row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
DiscountTable.displayName = 'DiscountTable';

export default DiscountTable;
