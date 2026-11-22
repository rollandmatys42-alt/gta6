# VICEHUB operational setup

This document records the external account configuration required to activate the product. Secrets must be entered in the secure Base44 app secret store, never committed to GitHub or pasted into chat.

## Private video storage — Cloudflare R2

Create a private R2 bucket. Keep public bucket access disabled. Configure bucket CORS to allow the published VICEHUB origin and the required PUT, GET and HEAD methods and Content-Type / Range headers.

Required Base44 secrets:

- VIDEO_STORAGE_ENDPOINT — account S3 endpoint, e.g. https://<account-id>.r2.cloudflarestorage.com
- VIDEO_STORAGE_BUCKET — private bucket name
- VIDEO_STORAGE_ACCESS_KEY_ID
- VIDEO_STORAGE_SECRET_ACCESS_KEY
- VIDEO_STORAGE_REGION — normally auto

R2 currently includes 10 GB-month standard storage in its free tier. Above that, standard storage is billed per GB-month. Egress to the public Internet is free. Actual monthly cost depends on total stored GB, operation class and region. There is no unlimited free 1,000-video plan.

The app uses private objects and short-lived signed URLs. Original masters and watermarked renditions are stored under separate keys. Never make the bucket public.


## Social account OAuth and direct publishing

Add these secure app secrets before enabling account connections:

- `SOCIAL_OAUTH_STATE_SECRET`: random secret of at least 32 characters used to sign one-time OAuth state.
- `SOCIAL_TOKEN_ENCRYPTION_KEY`: random secret of at least 32 characters used for AES-GCM encryption of per-user social access and refresh tokens.
- `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`: TikTok developer application credentials.
- `META_APP_ID` and `META_APP_SECRET`: Meta application credentials for Instagram Login.
- `META_GRAPH_API_VERSION`: the currently supported Graph API version configured for the Meta app.

Register this exact redirect URI with both provider apps:

`https://gta6-creator-hub-c26cc578.base44.app/social/callback`

TikTok requires the `user.info.basic` and `video.publish` scopes and approval/audit of the Content Posting API before public Direct Posts are available. Until TikTok approves the app, the creator account may only be able to publish privately. The app queries creator-specific privacy settings before preparing a post and requires the creator to confirm the destination and privacy setting.

Instagram publishing uses Instagram Login and the `instagram_business_basic` and `instagram_business_content_publish` scopes. The connected Instagram account must be a professional Creator or Business account. Meta App Review and any required business verification must be completed before general users can publish.

Direct social publishing uses the clean master file, never the VICEHUB watermarked rendition. The watermark is for VICEHUB free-tier downloads. TikTok's content-sharing rules do not permit third-party promotional watermarks on content uploaded through its sharing APIs. Direct publishing is therefore restricted to an active plan with clean-download entitlement and a video with documented commercial-use rights.

For TikTok browser-side chunk uploads, configure the private R2 bucket CORS policy to allow the VICEHUB origin `https://gta6-creator-hub-c26cc578.base44.app` to issue signed GET requests. Allow GET and HEAD from that origin; expose ETag. Do not make the bucket public. The upload URL returned by TikTok is a short-lived provider URL and is used only for the creator-confirmed upload.

Social tokens are encrypted before they are stored. They are never returned to the browser. Disconnect removes the stored token and attempts provider revocation. Do not paste provider secrets or access tokens into chat or public issue trackers.

## Commercial rights gate for video assets

A source URL alone is not proof of commercial distribution rights. Before a video can be published or used for direct social publishing, an administrator must record both the original source URL and a commercial-rights evidence reference (for example, a signed licence ID, written permission record or counsel-approved agreement reference). Keep the underlying permission document in the company's restricted legal records. Do not upload Rockstar-owned footage, characters, logos, maps or screenshots for monetised use unless the relevant commercial licence or permission has been obtained.

## Stripe recurring memberships

Required Base44 secrets:

- STRIPE_SECRET_KEY — restricted server-side secret key
- STRIPE_WEBHOOK_SECRET — signing secret for the endpoint below

Configure a Stripe webhook to:

https://gta6-creator-hub-c26cc578.base44.app/api/stripe/webhook

Subscribe to:

- checkout.session.completed
- customer.subscription.updated
- customer.subscription.deleted
- invoice.payment_failed
- invoice.paid

Before checkout can open, activate a SubscriptionPlan record for each tier/currency and set a positive monthly price and monthly download limit. Draft plans are deliberately not purchasable. The checkout creates a monthly recurring Stripe price from the active plan configuration. Customers manage or cancel through the Stripe Billing Portal. Enable the Customer Portal in Stripe settings and allow subscription cancellation. Keep plan switching disabled until VICEHUB supports and verifies tier-change handling.

## Social platform APIs

The app must be registered with each platform, the relevant products/scopes approved, and each creator must authorize their own account. Do not collect platform passwords.

Initial server configuration names:

- TikTok: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
- Instagram / Meta: META_APP_ID, META_APP_SECRET
- YouTube: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

Direct publishing is not enabled merely by adding credentials: OAuth redirect URLs, app review, account eligibility and each provider's publishing requirements must also be completed.

## Rights and media policy

Do not publish Rockstar / Take-Two game assets or footage for a paid subscription service without written commercial distribution rights. The platform must retain the rights evidence and source reference for every video. A rights checkbox is an internal workflow control, not a licence.

## Deployment workflow

All application changes are committed through GitHub branches and pull requests. After merge, the app is synced and deployed through the Base44 REST API. No Base44 Builder credits, Sandbox Bridge or VPS are used.
