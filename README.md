# Installation (dev staging setup using docker compose)

1. Copy .env-example to .env (this should work without modification)
1. Populate other .env files from the other repos:
   - `.env.callback` from [ereader-callback](Langham-Partnership/ereader-callback) (`.env.dist`)
   - `.env.shibboleth` from [shibboleth](Langham-Partnership/shibboleth) (`shibboleth-common/.env.dist`)
1. Log into GitHub Packages using one of the following

   1. Using Personal Access Token
      1. Create GitHub [classic personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#personal-access-tokens-classic) with the `read:packages` scope and an expiration date a year from now. Unfortunately [fine-grained is not supported](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry)
      1. Log into GitHub Packages using the GitHub personal access token as the password: `docker login ghcr.io`
   1. Using OAuth Token with [GitHub CLI](https://cli.github.com/)

      ```
      gh auth login --scopes read:packages
      gh auth token | docker login ghcr.io --password-stdin --username ${GITHUB_USERNAME}
      ```

1. Build and start the caddy service: `docker compose up -d caddy`
1. Pull other services: `docker compose pull`
1. Build and start the services: `docker compose up` (note that the caddy service must be started first, otherwise you may
   receive an error from Docker about the network)

# Proxy auto-configuration file

A file called `proxy.pac` is generated and hosted by Caddy, to simplify connecting to the services by domain name. To use it (assuming your Caddy service is accessible on `localhost`, set your proxy autoconfiguration URL to:

    https://localhost:3128/proxy.pac

You will also need to add the `rootCA.crt` root certificate to your OS or browser's certificates manager. This certificate is available inside the `Langham-Partnership/shibboleth-common:1.0.0-dev` Docker image, after this has been built.

# Installation (standalone server, dev mode)

1. `nvm use`
1. `npm install`
1. Copy .env-example.standalone to .env and update appropriately (DEV_NETWORK_IP for sure)
1. Create a MySQL database using `db_structure.sql` and `seeds.sql`
1. Change auto-increment for the `book` table to be some large number so as to not conflict with other devs (since the same aws s3 bucket is used)
1. Complete AWS setup (needed for import of epub or audiobook + testing emails)

(Unless emails need to be tested, you may simply log in with dev@toadreader.com, grabbing the login code from the logs.)

# Development

```bash
npm start
```

# Running Tests

## Available Commands

- Run all tests:

  ```bash
  npm test
  ```

- Run a specific test file (e.g., `auth_routes.test.ts`):

  ```bash
  npm test -- auth_routes
  ```

- Watch mode:

  ```bash
  npm test -- --watch
  ```

## Notes

- Make sure your `.env` files are correctly populated.
- Watch out for default setting assumptions (e.g., default language, video quality).
- All global states should be reset between tests to prevent cross-contamination.

# Demo

[toadreader.com/demo](https://toadreader.com/demo/)

# License

[AGPL-3.0](https://opensource.org/licenses/AGPL-3.0) ([summary](<https://tldrlegal.com/license/gnu-affero-general-public-license-v3-(agpl-3.0)>))
