/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * ct.mjs — two-project commercetools client factory.
 *
 * `ctClient('stage')` reads the project discounts are authored in.
 * `ctClient('prod')` is the only client that writes.
 *
 * Credentials resolve per project from `STAGE_CTP_*` / `PROD_CTP_*`, falling back
 * to un-prefixed `CTP_*`. Both sets are REQUIRED to differ in practice, and
 * `assertDistinctProjects` enforces it: with only `CTP_*` set, both sides resolve
 * to one project and every "deploy" would write back into the source. That is the
 * one misconfiguration that fails silently rather than loudly, so it is checked.
 *
 * The token request deliberately sends NO `scope` parameter, so each client gets
 * exactly the scopes it was granted. Requesting a narrower scope is not an option:
 * commercetools validates the requested scope against the literal granted strings,
 * so asking a `manage_project` client for `view_cart_discounts` is rejected with
 * `invalid_scope` ("Only the following permissions can be requested: manage_project").
 * Least privilege therefore has to be built into the API client itself — see
 * docs/setup.md.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
let loaded = false;
export function loadEnv() {
  if (loaded) return;
  loadDotenv(path.join(HERE, '..', '.env')); // service/.env
  loadDotenv(path.join(HERE, '..', '..', '.env')); // repo root .env
  loaded = true;
}

function creds(which) {
  loadEnv();
  const P = which.toUpperCase(); // STAGE / PROD
  const pick = (name) => process.env[`${P}_${name}`] ?? process.env[name];
  const out = {
    pk: pick('CTP_PROJECT_KEY'),
    id: pick('CTP_CLIENT_ID'),
    secret: pick('CTP_CLIENT_SECRET'),
    auth: (pick('CTP_AUTH_URL') || '').replace(/\/$/, ''),
    api: (pick('CTP_API_URL') || '').replace(/\/$/, ''),
  };
  const missing = Object.entries(out)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `[${which}] missing credentials: ${missing.join(
        ', '
      )} — set ${P}_CTP_* (see service/.env.example)`
    );
  }
  return out;
}

export function projectKeys() {
  return { stage: creds('stage').pk, prod: creds('prod').pk };
}

/**
 * Refuse to run when both sides point at one project. Without this the tool
 * appears to work and quietly writes the source project back onto itself.
 */
export function assertDistinctProjects() {
  const { stage, prod } = projectKeys();
  if (stage === prod) {
    throw new Error(
      `stage and prod both resolve to "${stage}". Set STAGE_CTP_* and PROD_CTP_* to two different projects.`
    );
  }
  return { stage, prod };
}

export async function ctClient(which = 'stage') {
  const { pk, id, secret, auth, api } = creds(which);
  const res = await fetch(`${auth}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    // no `scope` param — the token inherits exactly the client's own scopes
    body: 'grant_type=client_credentials',
  });
  const tok = await res.json().catch(() => ({}));
  if (!tok.access_token) {
    throw new Error(
      `[${which}] auth failed for project "${pk}": ${JSON.stringify(tok).slice(0, 300)}`
    );
  }
  const H = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

  const get = async (p) => (await fetch(`${api}/${pk}${p}`, { headers: H })).json();
  const post = async (p, body) => {
    const r = await fetch(`${api}/${pk}${p}`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(body),
    });
    const b = await r.json().catch(() => ({}));
    return { ok: r.status < 300, status: r.status, body: b };
  };
  const del = async (p) => {
    const r = await fetch(`${api}/${pk}${p}`, { method: 'DELETE', headers: H });
    const b = await r.json().catch(() => ({}));
    return { ok: r.status < 300, status: r.status, body: b };
  };
  const byKey = async (resource, key) => {
    const r = await fetch(`${api}/${pk}/${resource}/key=${encodeURIComponent(key)}`, {
      headers: H,
    });
    return r.status === 200 ? r.json() : null;
  };
  const all = async (p, pageSize = 200) => {
    const out = [];
    let offset = 0;
    for (;;) {
      const sep = p.includes('?') ? '&' : '?';
      const body = await get(`${p}${sep}limit=${pageSize}&offset=${offset}&withTotal=false`);
      if (!body || !Array.isArray(body.results)) {
        throw new Error(`[${which}] bad response for ${p}: ${JSON.stringify(body).slice(0, 200)}`);
      }
      out.push(...body.results);
      if (body.results.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  };

  return { which, pk, api, get, post, del, byKey, all, __refKeyCache: new Map() };
}
