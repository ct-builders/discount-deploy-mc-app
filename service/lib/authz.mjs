/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * authz.mjs — the authorization decision, separated from the JWT mechanics.
 *
 * Verifying the Merchant Center session token is `@commercetools-backend/express`'s
 * job and is not re-implemented or re-tested here. What IS ours is the question
 * that comes after a valid token: may THIS session drive THIS deployment?
 *
 * Keeping it in its own pure function is what makes that answerable in a unit
 * test — the alternative is a test that has to stand up a JWKS endpoint to
 * assert a project-key comparison.
 */

/**
 * The gateway has already proven the caller is a signed-in user with access to
 * `session.projectKey`. Require that project to be the one this deployment reads
 * from, so a session obtained for an unrelated project cannot deploy into our
 * target.
 *
 * Returns `{ ok: true }` or `{ ok: false, status, error }`.
 */
export function checkSession(session, sourceProjectKey) {
  if (!session || typeof session !== 'object') {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  if (!session.projectKey) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  if (!sourceProjectKey) {
    // Misconfiguration, not a caller problem — and refusing is the safe default,
    // because an empty expected value would otherwise match nothing or everything
    // depending on how it is compared.
    return { ok: false, status: 500, error: 'source project key is not configured' };
  }
  if (session.projectKey !== sourceProjectKey) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  return { ok: true };
}

/**
 * Map a Web `Request` onto the Express-ish shape `createSessionAuthVerifier`
 * expects: lower-cased header object, and a URL it can check the audience
 * against.
 */
export function toExpressLike(request, path) {
  const headers = {};
  for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;
  return { headers, method: request.method, url: path, originalUrl: path };
}
