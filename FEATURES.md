# FEATURES

What this repo implements, derived from the code.

## Resources it deploys

| Resource | Endpoint | Fields carried |
|---|---|---|
| Discount group | `discount-groups` | `name`, `description`, `sortOrder`, `isActive` |
| Product discount | `product-discounts` | `name`, `description`, `value`, `predicate`, `sortOrder`, `isActive`, `validFrom`, `validUntil` |
| Cart discount | `cart-discounts` | `name`, `description`, `value`, `cartPredicate`, `target`, `sortOrder`, `stackingMode`, `requiresDiscountCode`, `isActive`, `validFrom`, `validUntil`, `stores`, `discountGroup` |
| Discount code | `discount-codes` | `code`, `name`, `description`, `cartDiscounts`, `isActive`, `maxApplications`, `maxApplicationsPerCustomer`, `cartPredicate`, `groups`, `validFrom`, `validUntil` |

Applied in that order — `service/lib/util.mjs`, `RESOURCE_TYPES`.

## Reference handling

- `service/lib/serialize.mjs` — uuids in `cartPredicate`, `target.predicate` and
  a product discount's `predicate` are resolved to `{typeId, key}` in the source
  and recorded as `referenceMap`. A platform-supplied `references` array is used
  as a type hint; otherwise the id is probed against category, product, customer
  group, channel, product type, state, tax category and store.
- `service/lib/deploy.mjs` — `rewritePredicate` substitutes the target project's
  id for each mapped key. Key-based predicates pass through unchanged.
- `stores`, `discountGroup`, a code's `cartDiscounts`, and a `giftLineItem`
  value's `product` / `supplyChannel` / `distributionChannel` are emitted as
  key-based resource identifiers.
- Unresolvable references are recorded and reported, never silently dropped.

## Diff and deploy

- Upsert by key: create when absent, otherwise emit update actions only for
  fields that differ. Identical resources report `noop` and send no request.
- `prepare` and `deploy` share one code path, differing by a `dryRun` flag.
- Idempotent: a second deploy of the same selection is all no-ops.
- Per-resource result: `create` / `update` / `noop` / `error`, with the action
  names for an update and the API message for an error.

## Blockers — checked before any write

| Check | Where |
|---|---|
| a reference that resolved to no key in the source | `collectUnresolved` |
| a reference absent from the target project | `validateAgainstTarget` |
| a discount code whose `code` is already taken in the target under a different key, or none | `collectConflicts` |

A reference created by the same deploy is not counted missing. `force` overrides
the refusal; the CLI exposes it as `--force`.

## Dependency expansion

`expandSelection` — a selected discount code pulls in its cart discounts, and
those pull in their discount groups. Reported with a reason per addition. Off via
`autoDeps: false` (`--no-deps`).

## Pre-deploy id audit

`collectIdReferences` (`service/lib/serialize.mjs`) — every id a predicate
embeds, with `typeId`, the key it resolved to, and a status of `translatable` or
`unresolved-in-source`. A translatable id is surfaced as a **warning** naming
the `.key` predicate field that would remove the translation; an unresolved one
is a blocker. `type` and `product-discount` are in the probe list because
`custom.type.id` and `price.discount.id` are legal predicate fields.

## Safety

- `assertDistinctProjects` refuses to run when both projects resolve to the same
  key.
- The token request sends no `scope` parameter, so a client's own scopes apply.
  commercetools rejects a narrower request than the client was granted.
- The deployed function answers `503` when `APP_AUDIENCE` is unset, rather than
  serving an endpoint it cannot authenticate.
- `checkSession` (`service/lib/authz.mjs`) requires the verified session's
  project to be the source project: `401` without a session, `403` for a session
  belonging to another project, `500` when the source key is unconfigured rather
  than matching anything.
- `service/server.mjs` binds to `127.0.0.1` and says on startup that it is
  unauthenticated.
- A resource with no key is listed as not deployable, with the reason shown.

## Surfaces

| Surface | Entry point |
|---|---|
| Merchant Center Custom Application | `src/` — `entryPointUriPath: discount-deploy` |
| HTTP API, deployed | `netlify/functions/api.mjs` at `/api/*`, CORS-allow-listed to the Merchant Center origins |
| HTTP API, local | `service/server.mjs` on `:8080` |
| CLI | `service/bin/cli.mjs` — `list`, `prepare`, `deploy` |

### API routes

Deployed, every route except `/health` requires a Merchant Center session token
issued by the API Gateway's `/proxy/forward-to`, verified against its JWKS, with
`session.projectKey` required to equal the source project. No shared secret
exists: a static bundle on a public origin cannot hold one.

| Route | Returns |
|---|---|
| `GET /health` | ok, and the resource types — open, and names no project |
| `GET /config` | source and target project keys, and the caller's user id |
| `GET /discounts` | all four types from the source, each flagged `existsInTarget`, with an `editPath` |
| `POST /prepare` | the diff, dependencies added, warnings, blockers |
| `POST /deploy` | the same shape plus `applied`; always `200`, because the report carries the outcome |

## UI

- One selectable table per resource type: key, code, name, discount, active, and
  whether it is already in production.
- The discount column reads the value against the target, so 100% off `shipping`
  shows as "100% off on shipping" rather than as a free order, and a multi-buy
  target says "on 1 of every 2".
- Each key deep-links to that discount's own Merchant Center editing screen in
  the source project, opening in a new tab so an in-progress selection and diff
  survive. Discount groups have no such screen, so those rows are deliberately
  not linked.
- Selection is per row or per type; changing it clears a stale diff.
- Deploy is unavailable until a prepared plan has run, and says why it is unavailable
  — blockers outstanding, or nothing to do.
- The report shows dependencies pulled in, blockers with their remedy, failed
  writes with the API message, and the per-resource diff including no-ops.
- Light theme, ruled cells, shaded header rows, wide container.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `service/test/util.test.mjs` | 14 | the discount summary, target-aware phrasing, Merchant Center edit paths |
| `service/test/serialize.test.mjs` | 11 | reference mapping, key emission, unresolved detection, the id audit |
| `service/test/deploy.test.mjs` | 11 | predicate rewriting, create/noop/update, minimal actions, validation, conflicts, ordering |
| `service/test/diff.test.mjs` | 16 | listing, deep links, dependency expansion, warnings, blocked refusal, force, `'*'` |
| `service/test/api.test.mjs` | 12 | routes, session authorization, header mapping, distinct-project guard |
| `test/ui/components.spec.mjs` | 16 | the real components in a browser |

`npm run predeploy` runs typecheck, lint, the 64 unit tests and a production
build. `npm run test:ui` runs the browser suite separately.
