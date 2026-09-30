# Setup

Two commercetools projects, two API clients, one Netlify site.

## 1. The two projects

| Role | What it holds | How it is used |
|---|---|---|
| **Stage** | the discounts being authored | read only |
| **Production** | the live discounts | written, by the function only |

They must be different projects. Pointing both at one is the single
misconfiguration that would otherwise look like it works while writing the
source project back onto itself, so the service checks for it and refuses to
start a request.

## 2. The API clients

### Production — a scoped client, not an admin one

Create it in the Merchant Center under **Settings → Developer settings → API
clients**, or over the API with a client holding `manage_api_clients`. Grant
exactly:

```
manage_cart_discounts:<project>
manage_product_discounts:<project>
manage_discount_codes:<project>
view_products:<project>
view_categories:<project>
view_customer_groups:<project>
view_stores:<project>
view_states:<project>
view_tax_categories:<project>
```

The three `manage_*` scopes are the writes. `manage_cart_discounts` also covers
discount groups, so there is no separate scope to add for them.

The six `view_*` scopes are what a predicate rewrite reads: to turn a stage
category id into the production id for the same key, the client has to be able
to look that category up in production. A missing one of these fails partway
through a deploy rather than at the start, which is why they are granted up
front.

Nothing here can read or write products, orders, customers or carts.

### Stage — read is all it needs

Ideally the stage client holds only the matching `view_*` scopes. Note that
commercetools will not let you request a narrower token than the client was
granted: asking a `manage_project` client for `view_cart_discounts` is rejected
with `invalid_scope` — *"Only the following permissions can be requested:
manage_project"*. Least privilege has to be built into the client, so if the
stage client you have is an admin one, mint a read-only client to replace it
rather than expecting the service to downgrade its own token.

Minting one needs a client with `manage_api_clients` on the stage project; an
admin client created with `manage_project` alone does not have it.

## 3. Local development

```bash
npm install
cp service/.env.example service/.env
```

Fill in both credential blocks. The session-verification variables matter only
for a deployed site; `npm run service` does not use them.

```bash
npm run service     # the API on :8080
npm run cli list    # confirm both projects answer
```

Confirm credentials with the CLI before involving the Merchant Center — it
reports which project it reached and which discounts it found, so a wrong key or
a missing scope is obvious:

```bash
npm run cli list
npm run cli prepare --all
```

### Running the app itself

A custom application renders inside an authenticated Merchant Center session, so
it cannot be opened from disk:

```bash
npm start           # mc-scripts dev server, then log in to the Merchant Center
```

To verify the components without a Merchant Center session, use the harness —
it mounts the real table and report components against fixture data:

```bash
npm run test:ui                      # the specs
npm run build:harness                # then open test/ui/harness.html
```

## 4. The Netlify site

The app and the API deploy together as one site: `mc-scripts` builds the static
bundle into `public/`, and `netlify/functions/api.mjs` serves `/api/*`.

If the site name is not `mc-discount-deploy`, change **both** `apiBase` and the
CSP `connect-src` entry in
[custom-application-config.mjs](../custom-application-config.mjs) to match. The
Merchant Center runs the app on its own domain, so a relative API path does not
work — see [how-it-works.md](how-it-works.md).

```bash
netlify sites:create --name <site-name>
netlify link --name <site-name>
```

Set the environment variables on the site — the same names as
`service/.env.example`:

```bash
netlify env:set STAGE_CTP_PROJECT_KEY  <stage-project>
netlify env:set STAGE_CTP_CLIENT_ID    <id>
netlify env:set STAGE_CTP_CLIENT_SECRET <secret>
netlify env:set STAGE_CTP_AUTH_URL     https://auth.us-central1.gcp.commercetools.com
netlify env:set STAGE_CTP_API_URL      https://api.us-central1.gcp.commercetools.com
netlify env:set PROD_CTP_PROJECT_KEY   <production-project>
netlify env:set PROD_CTP_CLIENT_ID     <id>
netlify env:set PROD_CTP_CLIENT_SECRET <secret>
netlify env:set PROD_CTP_AUTH_URL      https://auth.us-central1.gcp.commercetools.com
netlify env:set PROD_CTP_API_URL       https://api.us-central1.gcp.commercetools.com
netlify env:set APP_AUDIENCE               https://<site-name>.netlify.app
netlify env:set APP_CLOUD_IDENTIFIER       gcp-us
```

`APP_AUDIENCE` must be identical to `apiBase` in
[custom-application-config.mjs](../custom-application-config.mjs), and
`APP_CLOUD_IDENTIFIER` to the app's `cloudIdentifier`. Without the audience the
function answers `503` rather than serving an endpoint it cannot authenticate.

Then deploy, and register the app: [REGISTRATION.md](../REGISTRATION.md).

## How the API is authenticated

Every call from the application goes through the Merchant Center API Gateway's
`/proxy/forward-to` endpoint. The gateway:

1. confirms the caller is a signed-in Merchant Center user,
2. confirms that user has access to the project named in `X-Project-Key`,
3. forwards the request to `apiBase` with a short-lived JWT it signs.

The function verifies that JWT against the gateway's JWKS
(`@commercetools-backend/express`), then requires `session.projectKey` to be the
**source** project this deployment reads from — so a session obtained for some
other project cannot drive a deploy into your target.

Two environment variables make that work, and the function returns `503`
without the first:

| Variable | Value |
|---|---|
| `APP_AUDIENCE` | this deployment's public origin, identical to `apiBase` |
| `APP_CLOUD_IDENTIFIER` | the app's `cloudIdentifier` — `gcp-us`, `gcp-eu`, … |

The audience policy is `forward-url-origin` on both sides, so the token's
audience is the origin rather than origin + path and one configured value covers
every route.

### Why not a shared token

A custom application is a static bundle served from a **public** origin. Any
secret compiled into it — including via `additionalEnv` — is readable by anyone
who fetches the site's `index.html`; no Merchant Center session is required to
do that. For an endpoint that can write to a production project, a shared bearer
token in the bundle is therefore equivalent to no authentication at all.

CORS is not a substitute. It is enforced by browsers and ignored by every other
HTTP client, so it restricts nothing about who can call the API directly.

### Local development

`npm run service` is **unauthenticated and binds to 127.0.0.1**. It exists so the
routes can be exercised without the Merchant Center in the way, and it must not
be exposed publicly — it can write to the target project. Use `npm run cli` for
the same operations from a terminal.

Driving the application itself against a local API means the gateway has to
reach your machine, which needs a public tunnel; see
[local development using a secure tunnel](https://docs.commercetools.com/merchant-center-customizations/concepts/integrate-with-your-own-api)
in the commercetools documentation.
