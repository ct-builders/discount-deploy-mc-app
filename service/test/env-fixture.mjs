/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 */

/**
 * Project credentials for the API tests, set as a side effect of importing this
 * module.
 *
 * It has to run before lib/ct.mjs is imported: that module fills in only the
 * variables that are not already present, so setting these first is what keeps
 * the test off any real `.env` on the machine. Importing this file above the
 * others gives that ordering without a statement between the imports.
 *
 * There is no API token here. Authentication is the transports' job, not the
 * router's, so nothing under test reads one.
 */
Object.assign(process.env, {
  STAGE_CTP_PROJECT_KEY: 'stage-project',
  STAGE_CTP_CLIENT_ID: 'sid',
  STAGE_CTP_CLIENT_SECRET: 'ssecret',
  STAGE_CTP_AUTH_URL: 'https://auth.example.test',
  STAGE_CTP_API_URL: 'https://api.example.test',
  PROD_CTP_PROJECT_KEY: 'prod-project',
  PROD_CTP_CLIENT_ID: 'pid',
  PROD_CTP_CLIENT_SECRET: 'psecret',
  PROD_CTP_AUTH_URL: 'https://auth.example.test',
  PROD_CTP_API_URL: 'https://api.example.test',
});
