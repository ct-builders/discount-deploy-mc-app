#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * cli.mjs — the same operations as the app, from a terminal.
 *
 *   node service/bin/cli.mjs list
 *   node service/bin/cli.mjs prepare --cart-discount FreeShip100
 *   node service/bin/cli.mjs deploy  --cart-discount FreeShip100
 *   node service/bin/cli.mjs prepare --all
 *
 * Useful for verifying credentials and for driving a deploy without the
 * Merchant Center, which is also how the end-to-end test exercises it.
 */
import { ctClient, assertDistinctProjects } from '../lib/ct.mjs';
import { listDiscounts, prepare, apply } from '../lib/diff.mjs';
import { RESOURCE_TYPES } from '../lib/util.mjs';

const FLAGS = {
  '--discount-group': 'discountGroups',
  '--product-discount': 'productDiscounts',
  '--cart-discount': 'cartDiscounts',
  '--discount-code': 'discountCodes',
};

function parse(argv) {
  const cmd = argv[0];
  const selection = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.selectionKey, []]));
  let all = false;
  let force = false;
  let autoDeps = true;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') all = true;
    else if (a === '--force') force = true;
    else if (a === '--no-deps') autoDeps = false;
    else if (FLAGS[a]) selection[FLAGS[a]].push(argv[++i]);
    else throw new Error(`unknown argument "${a}"`);
  }
  if (all) for (const k of Object.keys(selection)) selection[k] = '*';
  return { cmd, selection, force, autoDeps };
}

const ICON = { create: '+', update: '~', noop: '=', error: '!' };

function printResults(r) {
  if (r.added?.length) {
    console.log('\nPulled in as dependencies:');
    for (const a of r.added) console.log(`  ${a.key} — ${a.reason}`);
  }
  if (r.blockers?.length) {
    console.log('\nBLOCKERS (deploy refused):');
    for (const b of r.blockers) console.log(`  ${b.resource}: ${b.detail}`);
  }
  if (r.warnings?.length) {
    console.log('\nWARNINGS (deploy proceeds):');
    for (const w of r.warnings) console.log(`  ${w.resource}: ${w.detail}`);
  }
  if (r.results?.order?.length) {
    console.log(`\n${r.results.dryRun ? 'Would apply' : 'Applied'} (${r.source} → ${r.target}):`);
    for (const o of r.results.order) {
      const extra = o.error
        ? `  ERROR ${o.error}`
        : o.actions?.length
        ? `  [${o.actions.join(', ')}]`
        : '';
      console.log(
        `  ${ICON[o.action] || '?'} ${o.type.padEnd(17)} ${String(o.key).padEnd(24)} ${
          o.action
        }${extra}`
      );
    }
    const s = r.summary || {};
    console.log(
      `\n  create ${s.create || 0}  update ${s.update || 0}  no-op ${s.noop || 0}  error ${
        s.error || 0
      }`
    );
  } else if (!r.blockers?.length) {
    console.log('\nNothing selected.');
  }
}

async function main() {
  const { cmd, selection, force, autoDeps } = parse(process.argv.slice(2));
  assertDistinctProjects();
  const [stage, prod] = await Promise.all([ctClient('stage'), ctClient('prod')]);

  if (cmd === 'list') {
    const all = await listDiscounts(stage, prod);
    console.log(`${stage.pk} → ${prod.pk}\n`);
    for (const rt of RESOURCE_TYPES) {
      const items = all[rt.selectionKey];
      console.log(`${rt.label}s (${items.length})`);
      if (!items.length) console.log('  —');
      for (const i of items) {
        const state = i.existsInTarget === null ? '?' : i.existsInTarget ? 'in target' : 'NEW';
        const flags = [
          i.isActive ? 'active' : 'inactive',
          i.deployable ? null : 'NO KEY — not deployable',
        ].filter(Boolean);
        console.log(
          `  ${String(i.key ?? '(no key)').padEnd(24)} ${state.padEnd(10)} ${i.name}  (${flags.join(
            ', '
          )})`
        );
      }
      console.log('');
    }
    return;
  }

  if (cmd === 'prepare') return printResults(await prepare(stage, prod, selection, { autoDeps }));

  if (cmd === 'deploy') {
    const r = await apply(stage, prod, selection, { autoDeps, force });
    printResults(r);
    if (!r.applied) {
      console.log(`\nNot applied: ${r.reason}`);
      process.exitCode = 1;
    }
    return;
  }

  console.log(
    'usage: cli.mjs <list|prepare|deploy> [--all] [--cart-discount KEY] [--product-discount KEY] [--discount-code KEY] [--discount-group KEY] [--no-deps] [--force]'
  );
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  process.exitCode = 1;
});
