# Discount Deploy

A Merchant Center Custom Application that copies discounts from one
commercetools project into another — typically from a staging project into
production. Pick the discounts, read the diff, deploy.

> **[MIT](LICENSE), freely available, `AS IS` and UNSUPPORTED.** Reference code
> from the [`ct-builders`](https://github.com/ct-builders) org. This is **not** a
> commercetools product, and commercetools Support cannot help with it. Read
> [SUPPORT.md](SUPPORT.md) before building on it — particularly the part about
> pointing it at a production project, which is what it is for.

Merchandisers build and try out promotions in a staging project. This is the step
after that: moving a finished discount into production without retyping it, and
without a copy-paste mistake becoming a live pricing error.

## The problem it solves

A commercetools id is local to its project. The same category exists in both
projects under the same `key` and with two different `id`s — in the pair this was
built against, all 29 categories matched by key and **not one** matched by id.

That matters because a discount predicate is a string, and ids get embedded in
it:

```
lineItemExists(categories.id contains any ("70f731bb-61fd-4a6b-8a66-1f23796d4855"))
```

Copy that text into the other project and the predicate is valid, the discount
is active, and it matches nothing. Nothing errors. The promotion simply never
applies, and the first person to notice is a customer who did not get their
discount.

So this does not copy predicates. It reads every uuid out of them, resolves each
one to a `key` in the source project, and looks that key up in the target to get
the target's id. What lands in production is a predicate that points at the right
things. [docs/how-it-works.md](docs/how-it-works.md) covers the mechanism.

## What it does

- **All four discount resources** — cart discounts, product discounts, discount
  codes and discount groups, each with its own selectable table.
- **A diff before you commit to it.** Every selected discount reports `create`,
  `update` or `no change`, and an update names the fields that differ. Deploying
  something the target already matches is visibly a no-op rather than a silent
  write.
- **Dependencies come along.** Select a discount code and it brings the cart
  discounts it points at, and their discount group, in that order. The report
  says what was pulled in and why.
- **Every key deep-links to its own Merchant Center screen**, so checking what a
  discount actually does is one click rather than a hunt through the Discounts
  section. Opens in a new tab, because a same-tab navigation would discard the
  selection and the diff.
- **It refuses rather than half-succeeds.** A reference that does not exist in
  the target, or a discount code whose `code` is already taken there, is a
  blocker reported before anything is written.
- **Idempotent.** Deploy twice and the second run changes nothing.

The full inventory is in [FEATURES.md](FEATURES.md).

## How it fits together

```
  Merchant Center
        │  serves the app on ITS domain, proxying to your site
  ┌─────▼──────────────────┐
  │ the app                │  React, mc-scripts. Holds no credentials.
  └─────┬──────────────────┘
        │ fetch https://<your-site>/api/*
  ┌─────▼──────────────────┐
  │ /api — a function      │  The only component with credentials.
  │ service/lib/*.mjs      │
  └──┬──────────────────┬──┘
 read│                  │read + write
 ┌───▼───────────┐  ┌───▼──────────────┐
 │ SOURCE project│  │ TARGET project   │
 └───────────────┘  └──────────────────┘
```

A custom application is a static bundle, so it can keep no secret. Every
commercetools call therefore happens in the function, under its own credentials,
and the target project's write credentials exist nowhere else.

**The call is cross-origin, and that catches people out.** The Merchant Center
serves a custom application from **its own** domain and proxies to your URL, so
at runtime `location.origin` is `mc.<region>.commercetools.com`. A relative
`/api` resolves against the Merchant Center and comes back `401`. Three things
are needed together, and leaving out any one of them looks like an auth bug:

| What | Where |
|---|---|
| the API origin, absolute | `additionalEnv.apiBase` |
| that origin allowed to be called | the app's CSP `connect-src` |
| the Merchant Center origin allowed to call | the function's CORS headers |

The deployment here is one Netlify site serving both the app and the function,
which keeps it to a single deploy and one set of environment variables. Nothing
depends on Netlify specifically: `service/lib` is dependency-free Node ESM, and
`service/server.mjs` runs the same routes on any host.

## The target project's credentials

Give the target an API client with exactly these scopes — never an admin one:

```
manage_cart_discounts      manage_product_discounts      manage_discount_codes
view_products              view_categories               view_customer_groups
view_stores                view_states                   view_tax_categories
```

The three `manage_*` scopes are the writes; `manage_cart_discounts` also covers
discount groups. The six `view_*` scopes are what a predicate rewrite reads — to
turn a source category id into the target's id for the same key, the client has
to be able to look that category up. Nothing here can touch products, orders or
customers.

Note that commercetools will not let a token request narrow an existing client:
asking a `manage_project` client for `view_cart_discounts` is rejected with
`invalid_scope`. Least privilege has to be built into the client itself.
[docs/setup.md](docs/setup.md) has the detail.

## Quick start

```bash
npm install
cp service/.env.example service/.env   # credentials for both projects
npm run service                        # the API on :8080
```

The CLI drives the same operations without the Merchant Center, which is the
quickest way to confirm the credentials work:

```bash
npm run cli list
npm run cli preview --cart-discount SummerSale
npm run cli deploy  --cart-discount SummerSale
```

To run the application itself you need a Merchant Center session and a
registered application — [docs/setup.md](docs/setup.md), then
[REGISTRATION.md](REGISTRATION.md).

Before the first build, set your own deployment's values in
[custom-application-config.mjs](custom-application-config.mjs): `apiBase`, the
CSP `connect-src` entry, `url`, and the `applicationId` the Merchant Center
assigns at registration. They ship as `your-site` / `your-application-id`
placeholders.

## Layout

| Path | What it is |
|---|---|
| `src/` | the custom application: tables, diff report, selection |
| `service/lib/` | serialize, diff, deploy — zero dependencies, no framework |
| `service/server.mjs` | the API on localhost for development |
| `service/bin/cli.mjs` | the same operations from a terminal |
| `netlify/functions/api.mjs` | the deployed API |
| `test/ui/` | the real components in a browser, against fixtures |

## Checks

```bash
npm run predeploy     # typecheck, lint, 64 unit tests, production build
npm run test:ui       # 16 browser specs over the real components
```

`predeploy` is the gate and is fast enough to run on every deploy. The browser
suite needs a browser and a built harness, so it has its own command.

There is no CI configured. `predeploy` is the only thing standing between a
change and a broken clone, so please run it.

## What it deliberately does not do

- **No deletion.** A discount removed from the source is left alone in the
  target. Deploying is additive; removing a live promotion stays a deliberate
  act.
- **No rollback.** There is no snapshot of the target beforehand. For batched,
  reviewable, revertible releases across products and categories as well as
  discounts, see
  [ct-release-manager](https://github.com/ct-builders/ct-release-manager); this
  is the narrow case of moving discounts across.
- **A discount with no key cannot be deployed**, since the whole upsert is keyed
  by `key`. Such rows are listed but not selectable, with the reason shown.

## Documentation

- [docs/setup.md](docs/setup.md) — the two projects, the API clients and their
  scopes, the site, running locally
- [REGISTRATION.md](REGISTRATION.md) — registering the application in the
  Merchant Center
- [docs/how-it-works.md](docs/how-it-works.md) — the reference rewriting, the
  diff, and what is deliberately not handled
- [FEATURES.md](FEATURES.md) — what the code implements
- [SUPPORT.md](SUPPORT.md) — what "unsupported" means here
- [CONTRIBUTING.md](CONTRIBUTING.md)
