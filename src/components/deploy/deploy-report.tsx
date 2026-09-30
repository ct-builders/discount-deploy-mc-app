/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Text from '@commercetools-uikit/text';
import Spacings from '@commercetools-uikit/spacings';
import type { PrepareResponse, ResultAction } from './types';

/**
 * The diff, and after a deploy the same shape as the record of what happened.
 *
 * The verb per row is the whole point: `create` and `update` are the changes,
 * `no-op` means production already matches and is shown rather than hidden, so
 * "nothing happened" is visibly different from "nothing ran".
 */

const VERB: Record<ResultAction, { label: string; bg: string; fg: string }> = {
  create: { label: 'create', bg: '#e3f2e5', fg: '#186a3b' },
  update: { label: 'update', bg: '#e1ecfa', fg: '#12457f' },
  noop: { label: 'no change', bg: '#eceff3', fg: '#5c6873' },
  error: { label: 'error', bg: '#fbe4e2', fg: '#a02c1e' },
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '7px 12px',
  borderBottom: '1px solid #c9d1d9',
  background: '#f0f2f5',
  color: '#0c0d0e',
  fontWeight: 600,
  fontSize: '0.85rem',
};
const td: React.CSSProperties = {
  padding: '7px 12px',
  borderBottom: '1px solid #e7e9ee',
  fontSize: '0.88rem',
};

const Panel = ({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'error' | 'info';
  title: string;
  children: React.ReactNode;
}) => {
  const c = {
    warn: { border: '#e8c98a', bg: '#fdf7e8' },
    error: { border: '#e8a79e', bg: '#fdefed' },
    info: { border: '#b9cfe8', bg: '#f2f7fd' },
  }[tone];
  return (
    <div
      style={{
        border: `1px solid ${c.border}`,
        background: c.bg,
        borderRadius: 4,
        padding: '10px 14px',
      }}
    >
      <Text.Body isBold>{title}</Text.Body>
      {children}
    </div>
  );
};

const DeployReport = ({ data, applied }: { data: PrepareResponse; applied: boolean }) => {
  const summary = data.summary;
  const rows = data.results?.order ?? [];
  const errors = rows.filter((r) => r.action === 'error');

  return (
    <Spacings.Stack scale="m">
      {data.added.length > 0 && (
        <Panel tone="info" title="Also deploying, because the selection depends on them">
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {data.added.map((a) => (
              <li key={`${a.selectionKey}-${a.key}`} style={{ fontSize: '0.88rem' }}>
                <code>{a.key}</code> — {a.reason}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.blockers.length > 0 && (
        <Panel
          tone="warn"
          title={`${data.blockers.length} thing(s) must be fixed before this can deploy`}
        >
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {data.blockers.map((b, i) => (
              <li key={i} style={{ fontSize: '0.88rem', marginBottom: 4 }}>
                <strong>{b.resource}</strong>: {b.detail}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.warnings?.length > 0 && (
        <Panel
          tone="warn"
          title={`${data.warnings.length} thing(s) worth knowing before this deploys`}
        >
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {data.warnings.map((w, i) => (
              <li key={i} style={{ fontSize: '0.88rem', marginBottom: 4 }}>
                <strong>{w.resource}</strong>: {w.detail}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {errors.length > 0 && (
        <Panel tone="error" title={`${errors.length} write(s) failed`}>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {errors.map((e, i) => (
              <li key={i} style={{ fontSize: '0.88rem' }}>
                <code>{e.key}</code>: {e.error}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {rows.length > 0 && (
        <div>
          <div style={{ marginBottom: 6 }}>
            <Text.Subheadline as="h4">
              {applied ? 'Deployed' : 'What a deploy would do'}
            </Text.Subheadline>
            {summary && (
              <Text.Detail tone="secondary">
                {summary.create || 0} to create · {summary.update || 0} to update ·{' '}
                {summary.noop || 0} already match
                {summary.error ? ` · ${summary.error} failed` : ''}
                {data.source && data.target ? ` · ${data.source} → ${data.target}` : ''}
              </Text.Detail>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #c9d1d9' }}>
            <thead>
              <tr>
                <th style={th}>Resource</th>
                <th style={th}>Key</th>
                <th style={th}>{applied ? 'Result' : 'Would'}</th>
                <th style={th}>Fields</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const v = VERB[r.action] ?? VERB.noop;
                return (
                  <tr key={`${r.type}-${r.key}-${i}`}>
                    <td style={td}>{r.type}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.84rem' }}>{r.key}</td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '1px 8px',
                          borderRadius: 10,
                          background: v.bg,
                          color: v.fg,
                          fontSize: '0.78rem',
                          fontWeight: 600,
                        }}
                      >
                        {v.label}
                      </span>
                    </td>
                    <td style={{ ...td, color: '#5c6873', fontSize: '0.83rem' }}>
                      {r.error ? r.error : (r.actions || []).join(', ') || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Spacings.Stack>
  );
};
DeployReport.displayName = 'DeployReport';

export default DeployReport;
