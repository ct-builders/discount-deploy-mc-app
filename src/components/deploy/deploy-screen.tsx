/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useCallback, useEffect, useState } from 'react';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import PrimaryButton from '@commercetools-uikit/primary-button';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import DiscountTable from './discount-table';
import DeployReport from './deploy-report';
import { useApi, type ApiError } from '../../sdk/use-api';
import {
  LABELS,
  SELECTION_ORDER,
  countSelection,
  emptySelection,
  type ListResponse,
  type PrepareResponse,
  type Selection,
  type SelectionKey,
} from './types';

/**
 * The whole tool: choose discounts in the source project, read the diff, deploy.
 *
 * Preparing and deploying are separate steps on purpose. The prepared plan is the only
 * place the difference between "this creates a discount in production" and
 * "production already matches" is visible, and it costs nothing to look.
 */
const DeployScreen = () => {
  const { get, post } = useApi();

  const [list, setList] = useState<ListResponse | null>(null);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [plan, setPlan] = useState<PrepareResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'prepare' | 'deploy' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await get<ListResponse>('/discounts'));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    load();
  }, [load]);

  // Any change to the selection invalidates the diff on screen — showing a
  // plan computed for a different selection is worse than showing none.
  const mutate = (next: Selection) => {
    setSelection(next);
    setPlan(null);
    setApplied(false);
  };

  const toggle = (selectionKey: SelectionKey, key: string) => {
    const cur = selection[selectionKey];
    mutate({
      ...selection,
      [selectionKey]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    });
  };

  const toggleAll = (selectionKey: SelectionKey, keys: string[], select: boolean) => {
    mutate({ ...selection, [selectionKey]: select ? keys : [] });
  };

  const clearAll = () => mutate(emptySelection());

  const run = async (mode: 'prepare' | 'deploy') => {
    setBusy(mode);
    setError(null);
    try {
      const data = await post<PrepareResponse>(`/${mode}`, { selection, autoDeps: true });
      setPlan(data);
      setApplied(mode === 'deploy' && data.applied === true);
      // A deploy changes what is and is not already in production, so the
      // status column has to be re-read rather than assumed.
      if (mode === 'deploy' && data.applied) await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const selectedCount = countSelection(selection);
  const hasBlockers = Boolean(plan && plan.blockers.length > 0);
  const nothingToDo =
    Boolean(plan?.summary) && (plan!.summary!.create || 0) + (plan!.summary!.update || 0) === 0;

  if (loading) {
    return (
      <Spacings.Inline alignItems="center" scale="s">
        <LoadingSpinner scale="s" />
        <Text.Body>Reading discounts from both projects…</Text.Body>
      </Spacings.Inline>
    );
  }

  return (
    <Spacings.Stack scale="l">
      <div>
        <Text.Headline as="h1">Discount Deploy</Text.Headline>
        {list && (
          <Text.Body tone="secondary">
            Copying from <code>{list.source}</code> to <code>{list.target}</code>. Nothing is
            written to <code>{list.target}</code> until you press Deploy.
          </Text.Body>
        )}
      </div>

      {error && (
        <div
          style={{
            border: '1px solid #e8a79e',
            background: '#fdefed',
            borderRadius: 4,
            padding: '10px 14px',
          }}
        >
          <Text.Body isBold>Could not reach the deploy service</Text.Body>
          <Text.Detail>{error}</Text.Detail>
        </div>
      )}

      {list &&
        SELECTION_ORDER.map((k) => (
          <DiscountTable
            key={k}
            selectionKey={k}
            label={LABELS[k]}
            rows={list.discounts[k] || []}
            selected={selection[k]}
            onToggle={toggle}
            onToggleAll={toggleAll}
            showCode={k === 'discountCodes'}
          />
        ))}

      {/* The action bar sits with the tables rather than at the top, so the
          button is next to the rows it acts on. */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: '#ffffff',
          borderTop: '1px solid #c9d1d9',
          padding: '12px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Text.Body isBold>
          {selectedCount === 0 ? 'Nothing selected' : `${selectedCount} selected`}
        </Text.Body>
        <SecondaryButton
          label="Prepare deploy"
          onClick={() => run('prepare')}
          isDisabled={selectedCount === 0 || busy !== null}
        />
        <PrimaryButton
          label={
            applied
              ? 'Deployed'
              : plan
              ? `Deploy to ${list?.target ?? 'production'}`
              : 'Prepare deploy first'
          }
          onClick={() => run('deploy')}
          isDisabled={
            selectedCount === 0 || busy !== null || !plan || hasBlockers || nothingToDo || applied
          }
        />
        {selectedCount > 0 && (
          <SecondaryButton label="Clear" onClick={clearAll} isDisabled={busy !== null} />
        )}
        {busy && (
          <Spacings.Inline alignItems="center" scale="xs">
            <LoadingSpinner scale="s" />
            <Text.Detail>{busy === 'prepare' ? 'Comparing…' : 'Deploying…'}</Text.Detail>
          </Spacings.Inline>
        )}
        {/* Say why the button is off rather than leaving a dead control. */}
        {!busy && selectedCount > 0 && !plan && (
          <Text.Detail tone="secondary">Prepare the deploy to see what would change.</Text.Detail>
        )}
        {!busy && hasBlockers && (
          <Text.Detail tone="warning">
            Deploy is unavailable until the blockers below are resolved.
          </Text.Detail>
        )}
        {!busy && !hasBlockers && nothingToDo && !applied && (
          <Text.Detail tone="secondary">
            Everything selected already matches {list?.target}. Nothing to deploy.
          </Text.Detail>
        )}
      </div>

      {plan && <DeployReport data={plan} applied={applied} />}
    </Spacings.Stack>
  );
};
DeployScreen.displayName = 'DeployScreen';

export default DeployScreen;
