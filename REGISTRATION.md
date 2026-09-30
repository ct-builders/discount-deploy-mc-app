# Registering the app in the Merchant Center

A custom application is hosted by you and registered once per organization. Two
of these steps can only be done by a person in the Merchant Center UI.

## 1. Deploy the site first

The registration form asks for the app's URL, so the site has to exist:

```bash
npm run predeploy
netlify deploy --prod
```

## 2. Register it

In the Merchant Center, go to **Settings → Custom Applications → Add a custom
application**, and fill in:

| Field | Value |
|---|---|
| Application name | `Discount Deploy` |
| Application URL | the site's URL, e.g. `https://<site>.netlify.app` |
| Application entry point URI path | `discount-deploy` |
| Permissions | `View` |
| Main menu link label | `Discount Deploy` |
| Main menu link permissions | `View` |

The entry point URI path must be exactly `discount-deploy` — it is
`entryPointUriPath` in [src/constants.ts](src/constants.ts), and the permission
keys the app checks are derived from it.

## 3. Paste the application ID back and redeploy

Registration assigns an **Application ID**. Put it in
[custom-application-config.mjs](custom-application-config.mjs):

```js
env: {
  production: {
    applicationId: 'the-id-from-the-merchant-center',
    url: 'https://<site>.netlify.app',
  },
},
```

Then deploy again. The app is built with this value compiled in, so it does not
take effect until the next build.

## 4. Install it for the projects that should have it

Still in **Custom Applications**, install the app for each project whose team
should see it, and grant the `View` permission to the relevant teams.

Install it for the **stage** project. The app reads and writes nothing through
the Merchant Center session — both projects are reached by the function under
its own credentials — so the project a user is logged into does not decide where
the discounts come from. `STAGE_CTP_PROJECT_KEY` and `PROD_CTP_PROJECT_KEY` do.
Installing it on stage is what makes that match what the user sees, since the
app reads from stage and the header names both projects.

## 5. Confirm it works

Open **Discount Deploy** from the main menu. It should list the stage project's
discounts with an **In production** column. If it shows *"Could not reach the
deploy service"*:

| Symptom | Cause |
|---|---|
| `503` | `APP_AUDIENCE` is not set on the site |
| `401` | `APP_AUDIENCE` does not match `apiBase`, or `APP_CLOUD_IDENTIFIER` is the wrong cloud |
| `403` | the project you have open is not the source project the deployment reads from |
| `500` with a credentials message | a `*_CTP_*` variable is missing or wrong |
| a CSP error in the console | the site's own origin is missing from the app's `connect-src` |
| `401` with the token set correctly | `apiBase` is relative — it must be the site's absolute origin, because the Merchant Center runs the app on its own domain |
