# How it works

## The one thing to understand

A commercetools id is local to its project. The same category exists in stage and
in production under the same `key`, with two different `id`s — in the projects
this was built against, all 29 categories matched by key and not one matched by
id.

That matters because a discount predicate is a string, and ids get embedded in
it:

```
lineItemExists(categories.id contains any ("70f731bb-61fd-4a6b-8a66-1f23796d4855"))
```

Copy that text into production and the predicate is valid, the discount is
active, and it matches nothing — the id belongs to a category in the other
project. Nothing errors. The promotion simply never applies.

So the deploy does not copy predicates. It resolves them:

1. **Serialize** (`service/lib/serialize.mjs`) scans every predicate in the
   source project for uuids, resolves each one to `{typeId, key}` there, and
   records it as the discount's `referenceMap`.
2. **Deploy** (`service/lib/deploy.mjs`) looks up each of those keys in the
   target project and substitutes the target's id for the source's.

A predicate written against keys — `categories.key contains any ("home-decor")`
— has no uuids, so it passes through untouched.

Anything that is a reference rather than embedded text (a cart discount's
`stores` and `discountGroup`, a code's `cartDiscounts`) is emitted by key
instead, because resource drafts accept key-based resource identifiers and
commercetools resolves them on write.

## The diff and the deploy are one code path

`prepare` and `deploy` call the same function with a `dryRun` flag. A prepared plan
computed separately from the write is a prepared plan that can disagree with it.

Per discount, matched by `key`:

- absent in the target → `create`
- present and identical → `no change`, no request sent
- present and different → `update`, carrying only the actions for fields that
  actually differ

That last point is what makes the tool safe to re-run. Deploying an unchanged
discount is a no-op, not a rewrite, so a deploy of ten discounts where one
changed sends one update.

## The pre-deploy id audit

Translating an id works, but it is a dependency on a lookup succeeding on every
deploy, where a key-based predicate is portable as written. So preparing a
deploy reports every id a predicate carries, whether or not it will translate:

| status | meaning |
|---|---|
| `translatable` | resolved to a key here; the deploy will rewrite it |
| `unresolved-in-source` | matches nothing here, so there is no key to carry over |

A `translatable` id becomes a **warning** — the deploy proceeds — naming the
`.key` predicate field that would remove the translation step
(`categories.key`, `product.key`, `productType.key`, `custom.type.key`,
`price.channel.key`). An unresolved one is a **blocker**.

This is also why `type` and `product-discount` are in the probe list:
`custom.type.id` and `price.discount.id` are legal in a predicate, and an id
the probe cannot place resolves to nothing and blocks the deploy.

## What it refuses to do

A deploy is refused outright, before any write, when:

- **a reference cannot be resolved in the source** — a uuid in a predicate that
  matches nothing, so there is no key to carry across
- **a reference does not exist in the target** — a predicate naming a category
  production does not have. The discount would deploy and match nothing.
- **a discount code's `code` is already taken in the target.** Everything here is
  matched by `key`, but `code` is separately unique per project. A code authored
  with a key, whose production counterpart was created without one, looks absent
  to a key lookup — so the upsert would try to create it and commercetools would
  reject the write. The prepared plan reports this with the remedy: give the
  production one the same key and it becomes an update.

A reference satisfied by the same deploy does not count as missing — a code and
the cart discount it points at can be deployed together.

## Dependency order

Resource types are applied in one declared order, in
[`RESOURCE_TYPES`](../service/lib/util.mjs):

```
discount group → product discount → cart discount → discount code
```

A discount group has to exist before a cart discount joins it, and a cart
discount before a code points at it.

Selecting a discount code expands the selection to include its cart discounts,
and then their discount groups. The report names what was added and why, so the
extra rows in the diff are explained rather than surprising.

## Where things run

| Component | Runs | Holds credentials | Authenticates |
|---|---|---|---|
| the app | the browser, inside Merchant Center | no | n/a |
| `/api` | a Netlify Function | yes — both projects | verifies the MC session JWT |
| `server.mjs` | localhost, development only | yes | nothing — do not expose it |
| `service/lib` | inside those | reads them from the environment | n/a |

Authentication deliberately lives in the transports, not in `service/lib/api.mjs`:
the two cannot share a scheme, and putting one in the middle would make the other
wrong. By the time the router runs, the request is authorized. The decision that
*is* ours — may this session drive this deployment? — is
`service/lib/authz.mjs`, kept pure so it can be tested without standing up a
JWKS endpoint.

The app is a static bundle, so it can keep no secret. Putting the function on the
same site keeps deployment to one step, but it does **not** make the call
same-origin.

The Merchant Center serves a custom application from its own domain and proxies
to the app's URL, so the page's origin at runtime is
`mc.<region>.commercetools.com`. Three things follow, and leaving out any one of
them produces a 401 or a blocked request:

| What | Where |
|---|---|
| the API origin, absolute | `additionalEnv.apiBase` |
| that origin allowed to be called | the app's CSP `connect-src` |
| the Merchant Center origin allowed to call | the function's CORS headers |

The Merchant Center domains are per-region, so the allow-list is keyed to the
app's `cloudIdentifier`; `ALLOWED_ORIGINS` overrides it. The preflight is
answered before the token check, because a browser sends `OPTIONS` without the
`Authorization` header.

## Deliberately not handled

- **No deletion.** A discount removed in stage is left alone in production.
  Deploying is additive; removing a live promotion stays a deliberate act in the
  Merchant Center.
- **No rollback.** There is no snapshot of what production looked like
  beforehand. For batched, reviewable, revertible releases across products and
  categories as well as discounts, that is what
  [ct-release-manager](https://github.com/ct-builders/ct-release-manager) is for; this
  tool is the narrow case of moving discounts across.
- **A discount with no key cannot be deployed.** The whole upsert is keyed by
  `key`, and one cannot be invented in the target without losing the ability to
  match the same discount next time. Such rows are listed but not selectable,
  with the reason shown.
- **`sortOrder` is carried, not reconciled.** commercetools requires it to be
  unique per discount, so a source `sortOrder` already used by a *different*
  discount in production is rejected on write. The error is reported per
  resource; the fix is to change one of them.
- **No scheduling.** `validFrom` and `validUntil` are copied as authored.

## Testing

`service/test/` covers the logic with a commercetools stand-in built from plain
objects (`test/helpers.mjs`), which records the exact update actions sent. That
is what lets a test assert "only `changeValue` was sent" rather than only
checking a summary count.

`test/ui/` bundles the **real** table and report components with esbuild and
drives them in a browser against fixture payloads. They take plain props, which
is what makes that possible without a Merchant Center session — so what the
browser specs verify is the component that ships, not a copy of its markup.
