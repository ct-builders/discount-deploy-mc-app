/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { PERMISSIONS, entryPointUriPath } from './src/constants';

/**
 * @type {import('@commercetools-frontend/application-config').ConfigOptionsForCustomApplication}
 */
const config = {
  name: 'Discount Deploy',
  description:
    'Copy discounts from the stage project to production: pick them, read the diff, deploy.',
  entryPointUriPath,
  cloudIdentifier: 'gcp-us',

  additionalEnv: {
    // ABSOLUTE, and it has to be. The Merchant Center serves a custom
    // application from its OWN domain and proxies to the URL below, so at
    // runtime `location.origin` is mc.<region>.commercetools.com — a relative
    // "/api" resolves against the Merchant Center, not this site.
    //
    // Calls do not go straight here: src/sdk/use-api.ts routes them through the
    // Merchant Center API Gateway's /proxy/forward-to, which authenticates the
    // user and signs a short-lived token this URL's function verifies. So there
    // is deliberately NO api token in this config — a static bundle served from
    // a public origin cannot hold one, and anything put here is readable by
    // anyone who fetches the site.
    apiBase: 'https://your-site.netlify.app/api',
  },

  headers: {
    csp: {
      // The app talks to the Merchant Center API Gateway, which is already
      // allowed by the shell. 'self' covers the app's own assets.
      'connect-src': ["'self'"],
    },
  },

  env: {
    development: {
      initialProjectKey: 'your-stage-project',
    },
    production: {
      // Assigned by the Merchant Center at registration (Starters organization).
      // Compiled into the bundle at build time, so changing it needs a redeploy.
      applicationId: 'your-application-id',
      url: 'https://your-site.netlify.app',
    },
  },

  oAuthScopes: {
    // The app itself reads and writes nothing through the Merchant Center API —
    // every commercetools call happens in the function, under its own
    // credentials. These scopes exist so the Merchant Center has a permission to
    // grant, and so "who may open this app" is answerable in team settings.
    view: ['view_products'],
    manage: [],
  },

  icon: '${path:@commercetools-frontend/assets/application-icons/rocket.svg}',

  mainMenuLink: {
    defaultLabel: 'Discount Deploy',
    labelAllLocales: [],
    permissions: [PERMISSIONS.View],
  },
  submenuLinks: [],
};

export default config;
