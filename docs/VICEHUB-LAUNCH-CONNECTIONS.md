# VICEHUB launch connections and operating checklist

## 1. Fixed three-video starter pack
1. Upload three videos through Admin → Video Library.
2. Record the source/licence evidence for each, verify rights and prepare both clean and watermarked renditions.
3. Publish each video.
4. Open Edit on each of the three published videos and enable “Include in the fixed 3-video free sample pack”.
5. The fourth selection is blocked. To replace one, first uncheck the video being removed.
6. Every free account receives the same three IDs and can download each once. The pack does not reset monthly.

The production catalogue currently contains zero published, rights-verified videos, so the pack is not yet live.

## 2. Five-minute news collection
The GitHub workflow runs every five minutes. It calls the protected Base44 source collector.

Required secret:
- `GTA_NEWS_SYNC_CRON_SECRET`: a random secret of at least 32 characters. Add the exact same value in Base44 App Settings → Secrets and GitHub repository Settings → Secrets and variables → Actions.

Also required for X:
- `X_BEARER_TOKEN`: X API v2 Bearer token from the X Developer Portal.

The X source uses `since_id` to request only posts newer than the last processed post. The collector follows official Rockstar/PlayStation/Xbox accounts and a separate GTA VI keyword stream. YouTube official RSS, Reddit RSS, IGN, GameSpot, GTA BOOM, GTABase and Rockstar Intel feeds are configured.

Editorial policy:
- Official allowlisted X and official RSS updates may be auto-published as attributed official briefs.
- Community and media sources are ingested into drafts for review. This avoids automatically presenting rumours or unverified reporting as confirmed facts.
- Source images are used only when the source feed provides a usable HTTPS image URL. Otherwise VICEHUB uses its own neutral editorial artwork.
- AI rewriting uses OmniRoute and is instructed to use only supplied source material. It must not invent facts or reproduce third-party articles.

GitHub scheduled workflows can be delayed by the platform. Five-minute cadence is the configured target, not a hard real-time SLA.

## 3. Daily SEO, GEO and growth chief-of-staff
The daily workflow runs at 07:30 UTC and creates three reviewable AI drafts (SEO, GEO and growth plan). It does not silently rewrite or publish website pages.

It uses the same `GTA_NEWS_SYNC_CRON_SECRET` in Base44 and GitHub Actions. The agents have no real Search Console or Analytics metrics until these integrations are connected.

Required measurement credentials:
- `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`
- `GA4_REFRESH_TOKEN`

Do not interpret the 10,000 visits/day objective as a forecast or guarantee. Measure impressions, clicks, CTR, indexed pages, registrations, trial activation and paid conversion before scaling.

## 4. PWA and notifications
The PWA manifest, offline service worker, install control and notification bell are implemented. Members can enable browser notifications while VICEHUB is open.

For notifications to arrive when the app/browser is closed, add:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (the public HTTPS VICEHUB origin)
- `PUSH_DISPATCH_SECRET` (random secret, at least 32 characters)

Generate a VAPID pair with a trusted Web Push tool, store the private key only in Base44 Secrets, and never put it in GitHub or frontend code. Once these values exist, the device can subscribe through the bell and the push worker can deliver article/video alerts.

## 5. Current known blockers
- X token missing.
- News/growth scheduler secret missing from Base44 and GitHub Actions.
- VAPID and push dispatch secrets missing.
- Google Search Console and GA4 refresh tokens missing.
- Three sample videos not yet uploaded, verified, published and selected.
