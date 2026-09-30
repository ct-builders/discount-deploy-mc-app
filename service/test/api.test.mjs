/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */

// Must be first: it sets the credentials lib/ct.mjs reads on import.
import './env-fixture.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/api.mjs';
import { assertDistinctProjects } from '../lib/ct.mjs';
import { checkSession, toExpressLike } from '../lib/authz.mjs';

// ---- the router ----
// It performs no authentication of its own: each transport authenticates before
// calling it (the function verifies a Merchant Center session; server.mjs is
// localhost). These tests cover routing, not access control.

test('health reports the resource types it can deploy', async () => {
  const r = await handle({ method: 'GET', path: '/health' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.resourceTypes, [
    'discount-group',
    'product-discount',
    'cart-discount',
    'discount-code',
  ]);
});

test('config reports both projects', async () => {
  const r = await handle({ method: 'GET', path: '/config' });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'stage-project');
  assert.equal(r.body.target, 'prod-project');
});

test('config attributes the caller when a session was verified', async () => {
  const r = await handle({
    method: 'GET',
    path: '/config',
    session: { userId: 'user-1', projectKey: 'stage-project' },
  });
  assert.equal(r.body.user, 'user-1');
});

test('a trailing slash resolves to the same route', async () => {
  const r = await handle({ method: 'GET', path: '/config/' });
  assert.equal(r.status, 200);
});

test('an unknown route is a 404, not a crash', async () => {
  const r = await handle({ method: 'GET', path: '/nope' });
  assert.equal(r.status, 404);
});

test('pointing both sides at one project is refused', () => {
  const saved = process.env.PROD_CTP_PROJECT_KEY;
  process.env.PROD_CTP_PROJECT_KEY = 'stage-project';
  assert.throws(() => assertDistinctProjects(), /both resolve to "stage-project"/);
  process.env.PROD_CTP_PROJECT_KEY = saved;
});

test('distinct projects pass the guard', () => {
  assert.deepEqual(assertDistinctProjects(), { stage: 'stage-project', prod: 'prod-project' });
});

// ---- the authorization decision the function makes after verifying a token ----

test('a session for the source project is allowed', () => {
  assert.deepEqual(checkSession({ userId: 'u', projectKey: 'stage-project' }, 'stage-project'), {
    ok: true,
  });
});

test('a session for a different project is forbidden, not merely unauthorized', () => {
  const v = checkSession({ userId: 'u', projectKey: 'someone-elses-project' }, 'stage-project');
  assert.equal(v.ok, false);
  assert.equal(v.status, 403);
});

test('no session at all is unauthorized', () => {
  assert.equal(checkSession(null, 'stage-project').status, 401);
  assert.equal(checkSession({}, 'stage-project').status, 401);
  assert.equal(checkSession({ userId: 'u' }, 'stage-project').status, 401);
});

test('an unconfigured source project refuses rather than matching anything', () => {
  const v = checkSession({ projectKey: 'stage-project' }, undefined);
  assert.equal(v.ok, false);
  assert.equal(v.status, 500);
});

test('headers are lower-cased for the verifier, and the path is carried', () => {
  const req = {
    method: 'POST',
    headers: new Map([
      ['Authorization', 'Bearer x'],
      ['X-Project-Key', 'stage-project'],
    ]),
  };
  const shim = toExpressLike(req, '/deploy');
  assert.equal(shim.headers.authorization, 'Bearer x');
  assert.equal(shim.headers['x-project-key'], 'stage-project');
  assert.equal(shim.originalUrl, '/deploy');
  assert.equal(shim.method, 'POST');
});
