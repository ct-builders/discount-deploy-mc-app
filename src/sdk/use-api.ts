/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useCallback, useMemo } from 'react';
import createHttpUserAgent from '@commercetools/http-user-agent';
import { buildApiUrl, executeHttpClientRequest } from '@commercetools-frontend/application-shell';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';

/**
 * Client for this deployment's own API.
 *
 * Every call goes through the Merchant Center API Gateway's `/proxy/forward-to`
 * endpoint rather than straight to the API. That is what makes the request
 * authenticated: the gateway checks the signed-in user may use the current
 * project, then forwards to `apiBase` with a short-lived JWT it signs, which the
 * function verifies against the gateway's JWKS.
 *
 * The important consequence is that **nothing secret is in this bundle**. A
 * custom application is static and served from a public origin, so any token
 * compiled in here is readable by anyone who fetches the site — no Merchant
 * Center session needed. Routing through the gateway removes the need for one.
 *
 * `audiencePolicy: 'forward-url-origin'` makes the gateway mint the token with
 * this deployment's origin as the audience rather than origin + path, so the
 * function can verify every route against a single configured audience.
 */
type Env = { apiBase?: string; applicationName?: string };

export type ApiError = Error & { status?: number; body?: unknown };

export const useApi = () => {
  const env = useApplicationContext<Env>((context) => context.environment as unknown as Env);
  const base = (env?.apiBase || '').replace(/\/$/, '');

  const userAgent = useMemo(
    () =>
      createHttpUserAgent({
        name: 'discount-deploy',
        version: '1.0.0',
        libraryName: 'discount-deploy-mc-app',
      }),
    []
  );

  const request = useCallback(
    async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      if (!base) {
        const err: ApiError = new Error(
          'apiBase is not configured — set it in custom-application-config.mjs'
        );
        err.status = 0;
        throw err;
      }
      return executeHttpClientRequest<T>(
        async (options: { headers: Record<string, string>; credentials?: RequestCredentials }) => {
          const res = await fetch(buildApiUrl('/proxy/forward-to'), {
            ...options,
            method,
            headers: { ...options.headers, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          return {
            data: data as T,
            statusCode: res.status,
            getHeader: (key: string) => res.headers.get(key),
          };
        },
        {
          userAgent,
          forwardToConfig: {
            uri: `${base}${path}`,
            audiencePolicy: 'forward-url-origin',
          },
        }
      );
    },
    [base, userAgent]
  );

  const get = useCallback(<T>(path: string) => request<T>('GET', path), [request]);
  const post = useCallback(
    <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    [request]
  );

  return { base, get, post };
};
