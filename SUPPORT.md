# Support

**There is none.** This repository is reference code published `AS IS` under
[MIT](LICENSE). It is not a commercetools product, it carries no SLA, and
**commercetools Support cannot help with it** — please do not open a support
ticket about it.

Bugs and questions belong in this repository's GitHub issues. They are read on a
best-effort basis by the people who wrote the code, in whatever time they have.
Expect no response time.

## Before you point this at a production project

Which is what it is for, so read this part.

- **It writes to the target project.** Creating and updating cart discounts,
  product discounts, discount codes and discount groups is the whole function.
  Give it a target you are willing to have written to.
- **Use a least-privilege API client**, not an admin one. The exact scope list is
  in the [README](README.md#the-target-projects-credentials). Nothing here needs
  access to products, orders or customers.
- **Read the diff.** Every deploy is preceded by a preview showing `create`,
  `update` or `no change` per discount, and an update names the fields it would
  change. The preview and the deploy run the same comparison, so it is a truthful
  one.
- **There is no rollback.** Nothing snapshots the target beforehand. A wrong
  deploy is undone by hand, or by deploying a corrected source discount over it.
- **A live discount takes effect immediately.** A discount deployed with
  `isActive: true` starts applying to carts as soon as it is written. If that is
  not what you want, deactivate it in the source first and deploy the activation
  separately.
- **Access is controlled by the Merchant Center.** Requests reach the API only
  through the Merchant Center API Gateway, which authenticates the user and
  confirms their access to the project; the function verifies the gateway's
  signature and requires the session's project to be the source project. So who
  may deploy is exactly who you granted the application to in the Merchant
  Center. There is no shared API token to leak — see
  [docs/setup.md](docs/setup.md#how-the-api-is-authenticated).
- **`npm run service` is unauthenticated** and binds to localhost. It can write
  to the target project. Do not expose it.

## Reporting something

A useful report includes the resource type, whether it was a create or an
update, and what the preview said versus what happened. `npm run cli preview`
reproduces most problems without the Merchant Center in the way.

Please do not include real credentials, project keys you would rather not
publish, or customer data in an issue.
