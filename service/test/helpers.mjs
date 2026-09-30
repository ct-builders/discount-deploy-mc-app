/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */

/**
 * A commercetools client stand-in backed by plain objects.
 *
 * `store` is { endpoint: [resources] }. Writes are recorded on `client.writes`
 * so a test can assert on the exact update actions sent rather than only on the
 * summary — which is the point of most of these tests.
 */
export function fakeClient(pk, store = {}) {
  const data = JSON.parse(JSON.stringify(store));
  const writes = [];
  const find = (ep, pred) => (data[ep] || []).find(pred);

  const client = {
    pk,
    which: pk,
    writes,
    data,
    __refKeyCache: new Map(),
    async get(path) {
      // "/categories/<id>" or "/discount-codes?where=..."
      const [, ep, rest] = path.match(/^\/([^/?]+)(?:\/([^?]+))?/) || [];
      if (rest) {
        const o = find(ep, (x) => x.id === rest);
        return o || { statusCode: 404 };
      }
      const where = decodeURIComponent((path.match(/where=([^&]+)/) || [])[1] || '');
      const m = where.match(/^code="(.+)"$/);
      const results = m ? (data[ep] || []).filter((x) => x.code === m[1]) : data[ep] || [];
      return { results, count: results.length };
    },
    async byKey(ep, key) {
      return find(ep, (x) => x.key === key) || null;
    },
    async all(path) {
      const ep = path.replace(/^\//, '').split('?')[0];
      return data[ep] || [];
    },
    async post(path, body) {
      const [, ep, keyPart] = path.match(/^\/([^/]+)(?:\/key=(.+))?$/) || [];
      if (keyPart) {
        const key = decodeURIComponent(keyPart);
        writes.push({ kind: 'update', endpoint: ep, key, actions: body.actions });
        const o = find(ep, (x) => x.key === key);
        if (o) o.version = (o.version || 1) + 1;
        return { ok: true, status: 200, body: o };
      }
      writes.push({ kind: 'create', endpoint: ep, draft: body });
      const created = { ...body, id: `${ep}-${(data[ep] || []).length + 1}-id`, version: 1 };
      (data[ep] = data[ep] || []).push(created);
      return { ok: true, status: 201, body: created };
    },
    async del() {
      return { ok: true, status: 200, body: {} };
    },
  };
  return client;
}

export const uuid = (n) => `${String(n).repeat(8)}-aaaa-bbbb-cccc-${String(n).repeat(12)}`;
