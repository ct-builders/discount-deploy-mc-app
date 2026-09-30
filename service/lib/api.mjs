/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * api.mjs — the routes, as one transport-agnostic function.
 *
 * `handle({ method, path, body, session })` → `{ status, body }`.
 *
 * **Authentication is the caller's job, not this module's.** The two transports
 * authenticate differently and neither can be expressed here:
 * netlify/functions/api.mjs verifies a Merchant Center session token against the
 * gateway's JWKS, while server.mjs is a localhost development server. Putting a
 * single scheme in the middle would make one of them wrong. By the time `handle`
 * runs, the request is authorized.
 *
 * `session` — `{ userId, projectKey, userPermissions }` when the caller verified
 * one — is carried through so a route can attribute an action. Nothing depends
 * on it today.
 *
 * Clients are built per request. Tokens are short-lived and a request is the
 * natural cache boundary; the id↔key caches on each client are likewise scoped
 * to the request, which is what keeps a prepared plan from reusing a lookup made
 * before someone else changed the target.
 */
import { ctClient, assertDistinctProjects, projectKeys } from './ct.mjs';
import { listDiscounts, prepare, apply } from './diff.mjs';
import { RESOURCE_TYPES } from './util.mjs';

const json = (status, body) => ({ status, body });

async function clients() {
  assertDistinctProjects();
  const [stage, prod] = await Promise.all([ctClient('stage'), ctClient('prod')]);
  return { stage, prod };
}

export async function handle({ method = 'GET', path = '/', body = null, session = null } = {}) {
  const route = `${method.toUpperCase()} ${path.replace(/\/+$/, '') || '/'}`;

  if (route === 'GET /health') {
    return json(200, { ok: true, resourceTypes: RESOURCE_TYPES.map((r) => r.type) });
  }

  try {
    switch (route) {
      case 'GET /config': {
        const { stage, prod } = projectKeys();
        return json(200, {
          source: stage,
          target: prod,
          user: session?.userId ?? null,
          resourceTypes: RESOURCE_TYPES.map(({ type, selectionKey, label }) => ({
            type,
            selectionKey,
            label,
          })),
        });
      }

      case 'GET /discounts': {
        const { stage, prod } = await clients();
        return json(200, {
          source: stage.pk,
          target: prod.pk,
          discounts: await listDiscounts(stage, prod),
        });
      }

      case 'POST /prepare': {
        const { stage, prod } = await clients();
        const autoDeps = body?.autoDeps !== false;
        return json(200, await prepare(stage, prod, body?.selection || {}, { autoDeps }));
      }

      case 'POST /deploy': {
        const { stage, prod } = await clients();
        const autoDeps = body?.autoDeps !== false;
        const result = await apply(stage, prod, body?.selection || {}, {
          autoDeps,
          force: body?.force === true,
        });
        // 200 even when nothing was applied. The response is a report, and
        // `applied` plus `reason` say what happened; a refusal to write is a
        // normal outcome of asking, not a transport-level failure. It also
        // keeps the blockers reachable by every client, including HTTP wrappers
        // that turn a non-2xx into an exception and discard the body.
        return json(200, result);
      }

      default:
        return json(404, { error: `no route for ${route}` });
    }
  } catch (e) {
    return json(500, { error: e?.message || String(e) });
  }
}
