# VICEHUB — Reverse API Engineer integration

## Purpose

Use [Reverse API Engineer](https://github.com/kalil0321/reverse-api-engineer) as a development-time network inspection and typed-client generator. It is not a production API server and must not be run inside a Base44 request handler.

RAE opens or drives a browser, records the site's network traffic, and generates a typed client. Base44's current backend runs Deno functions and TanStack Start server handlers; it is not a persistent Python/Chromium desktop environment. Therefore the supported integration is:

1. Run RAE from a controlled developer workstation or compatible coding-agent environment.
2. Capture only public, permitted Rockstar/GTA pages and requests. Prefer official public endpoints.
3. Review the HAR and generated client. Remove cookies, bearer tokens, session identifiers, personal data and any private account material before committing.
4. Port the reviewed client to TypeScript/Deno and place it under `base44/functions/gta-news-sync/clients/`.
5. Store provider credentials only in Base44 Secrets. Never commit secrets or HAR files containing credentials.
6. Deploy the backend function and validate the response, rate limits, source attribution and duplicate handling before enabling the source.

## Install RAE in the development environment

Follow the upstream installation instructions. Current upstream quick start:

```bash
uv tool install reverse-api-engineer
npx skills add kalil0321/reverse-api-engineer
```

RAE agent mode needs a configured supported model SDK and browser provider. Manual mode additionally requires the manual extra and Chromium. Check the upstream README for current Node, browser and platform requirements before running it.

## Capture targets

- Rockstar Newswire / GTA VI official pages: capture public listing and article requests without logging in.
- Rockstar official media pages: capture public metadata only; do not download or redistribute copyrighted media unless the rights permit it.
- X: use the official X API for search and post data where the account has the required access. Do not reverse engineer private endpoints or bypass access controls.
- Other GTA publishers: ingest their public RSS/Atom feeds where available, with source attribution.

## Live ingestion in VICEHUB

The deployed `gta-news-sync` function processes enabled `NewsSource` records. RSS/Atom sources are imported as unpublished drafts. X API sources use `X_BEARER_TOKEN` and the configured API URL. Each source records its last checked time and status. Imported articles are deduplicated by source URL and remain drafts until editorial review.

A GitHub Actions schedule calls the protected `/api/news/sources/cron` route every 15 minutes. It requires the same random secret to be configured in:
- Base44 app Secrets: `GTA_NEWS_SYNC_CRON_SECRET`
- GitHub repository Actions secrets: `GTA_NEWS_SYNC_CRON_SECRET`

For X ingestion, also configure `X_BEARER_TOKEN` in Base44 Secrets. Never paste either value into source code or chat.

## Boundaries

- A generated client is not proof of an official or stable API.
- Do not bypass authentication, paywalls, rate limits, anti-bot measures or access restrictions.
- Do not publish unreviewed API output as verified facts.
- Respect Rockstar, Take-Two, X and publisher terms, copyright and applicable data-protection law.
- No claim of complete or instantaneous access: the scheduler runs every 15 minutes, and provider rate limits or outages can delay collection.
