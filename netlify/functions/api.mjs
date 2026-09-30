/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * The deployed API — a Netlify Function serving the same routes as
 * service/server.mjs, and the only component holding commercetools credentials.
 *
 * Every request must carry a Merchant Center session token, which the Merchant
 * Center API Gateway issues when the application calls it through
 * `/proxy/forward-to`. The token is a short-lived JWT signed by the gateway,
 * verified here against its JWKS.
 *
 * Why not a shared token: a custom application is a STATIC bundle served from a
 * public origin. Any secret compiled into it is readable by anyone who fetches
 * the site's index.html — no Merchant Center session required — which makes a
 * shared bearer token equivalent to no authentication at all for an endpoint
 * that can write to a production project. CORS does not help either; it is
 * enforced by browsers and ignored by everything else.
 *
 * What the gateway guarantees before this function ever runs:
 *   - the caller is a signed-in Merchant Center user
 *   - that user has access to the project named in `X-Project-Key`
 * On top of that, this function requires the project to be the SOURCE project
 * the deployment is configured for, so a session for some unrelated project
 * cannot drive it.
 */
import { createSessionAuthVerifier, CLOUD_IDENTIFIERS } from '@commercetools-backend/express';
import { handle } from '../../service/lib/api.mjs';
import { projectKeys } from '../../service/lib/ct.mjs';
import { checkSession, toExpressLike } from '../../service/lib/authz.mjs';

const cloudIdentifier = process.env.APP_CLOUD_IDENTIFIER || CLOUD_IDENTIFIERS.GCP_US;

/**
 * `audience` is this site's public origin, and must match what the application
 * sends. The application uses the `forward-url-origin` audience policy, so the
 * gateway mints a token whose audience is the origin alone rather than
 * origin + path — otherwise every route would need its own audience.
 */
const sessionAuthVerifier = createSessionAuthVerifier({
  audience: process.env.APP_AUDIENCE,
  audiencePolicy: 'forward-url-origin',
  issuer: cloudIdentifier,
  getRequestUrl: (request) => request.originalUrl || '/',
});

const json = (body, status) => Response.json(body, { status });

const handler = async (req) => {
  const url = new URL(req.url);
  const path =
    url.pathname.replace(/^\/api/, '').replace(/^\/\.netlify\/functions\/api/, '') || '/';

  // No CORS headers anywhere: the request arrives server-to-server from the
  // Merchant Center API Gateway, not from a browser, so there is no preflight
  // and nothing to allow. A browser calling this directly is meant to fail.
  if (req.method === 'OPTIONS') return new Response(null, { status: 405 });

  // Health is deliberately open and says nothing about either project.
  if (req.method === 'GET' && path === '/health') {
    return json({ ok: true }, 200);
  }

  if (!process.env.APP_AUDIENCE) {
    return json(
      { error: 'APP_AUDIENCE is not set on this site — cannot verify Merchant Center sessions' },
      503
    );
  }

  let session;
  try {
    const shim = toExpressLike(req, path);
    await sessionAuthVerifier(shim, {});
    session = shim.session;
  } catch {
    // Deliberately terse: a caller who cannot present a session does not get to
    // learn why, nor which projects this deployment is wired to.
    return json({ error: 'unauthorized' }, 401);
  }

  // The gateway proved the user may use `session.projectKey`; checkSession
  // requires it to be the project this deployment reads from.
  let stage;
  try {
    stage = projectKeys().stage;
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
  const verdict = checkSession(session, stage);
  if (!verdict.ok) return json({ error: verdict.error }, verdict.status);

  let body = null;
  if (req.method !== 'GET') {
    const raw = await req.text();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: 'invalid JSON body' }, 400);
      }
    }
  }

  const { status, body: out } = await handle({ method: req.method, path, body, session });
  return out === null ? new Response(null, { status }) : json(out, status);
};

export default handler;

export const config = { path: '/api/*' };
