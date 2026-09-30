# Contributing

Pull requests are welcome. This is unsupported reference code maintained in
spare time, so a small, self-contained change has a much better chance of
landing than a large one.

## Before you open a PR

```bash
npm install
npm run predeploy     # typecheck, lint, unit tests, production build
npm run test:ui       # browser specs over the real components
```

`predeploy` must pass. It is the only gate — there is no CI on this repository,
so a change that breaks it breaks it for the next person who clones.

## What the tests expect

- **`service/lib` stays dependency-free.** It is plain Node ESM with no imports
  outside the standard library, which is what lets it run in a function, in
  `server.mjs`, in the CLI and in tests without a build step. A new dependency
  there needs a reason.
- **Unit tests use the client stand-in in `service/test/helpers.mjs`**, not the
  network. It records the exact update actions sent, so a test can assert "only
  `changeValue` was sent" rather than checking a summary count. Prefer that over
  a looser assertion.
- **Browser specs mount the real components** from `src/`, not a copy of their
  markup, against fixture payloads in `test/ui/harness.tsx`. If you change a
  component's props, update the harness rather than duplicating the component.

## Adding a discount resource type

`RESOURCE_TYPES` in `service/lib/util.mjs` is the single place the set and its
dependency order are declared. Adding an entry there, a serializer in
`serialize.mjs` and an upsert in `deploy.mjs` is the whole change — the list, the
diff, the selection UI and the CLI flags all derive from it.

## Style

Prettier and ESLint are configured; `npm run format` applies them. Comments
should explain why something is the way it is, especially where the platform
forced it — those are the notes that save the next person an afternoon.

## Licensing

By contributing you agree your contribution is licensed under [MIT](LICENSE).
Every source file carries an `SPDX-License-Identifier` header because this code
gets consumed by copy-paste, and the header is the only part of the licensing
that travels with a single file. `npm run predeploy` does not check for it —
please keep it on new files.
