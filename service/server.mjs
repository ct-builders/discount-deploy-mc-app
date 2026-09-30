#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * server.mjs — the API on localhost for development, over node:http.
 *
 * **This server is unauthenticated and binds to localhost only.** It exists so
 * the routes can be exercised without the Merchant Center in the way; it is not
 * the deployed API. Deployed, the same routes run as a Netlify Function which
 * verifies a Merchant Center session token on every request
 * (netlify/functions/api.mjs). Both call lib/api.mjs.
 *
 * Do not put this on a public address. It can write to the target project, and
 * there is nothing here to stop anyone who can reach the port.
 */
import http from 'http';
import { handle } from './lib/api.mjs';
import { projectKeys } from './lib/ct.mjs';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';

// Development only: `npm start` serves the app from another port.
const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname.replace(/^\/api/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ error: 'invalid JSON body' }));
    }
  }

  const { status, body: out } = await handle({ method: req.method, path, body });

  console.log(`${req.method} ${url.pathname} → ${status}`);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(out === null ? '' : JSON.stringify(out));
});

server.listen(PORT, HOST, () => {
  let where;
  try {
    const { stage, prod } = projectKeys();
    where = `${stage} → ${prod}`;
  } catch (e) {
    where = `NOT CONFIGURED (${e.message})`;
  }
  console.log(`discount-deploy API on http://${HOST}:${PORT}`);
  console.log(`  ${where}`);
  console.log('  unauthenticated, localhost only — the deployed function verifies MC sessions');
});
