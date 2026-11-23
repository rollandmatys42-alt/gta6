# VICEHUB operational setup

This document records the external account configuration required to activate the product. Secrets must be entered in the secure Base44 app secret store, never committed to GitHub or pasted into chat.

## Private video storage — Cloudflare R2

Create a private R2 bucket. Keep public bucket access disabled. Configure bucket CORS to allow the published VICEHUB origin and the required PUT, GET and HEAD methods and Content-Type / Range headers.

Required Base44 secrets (four):

- VIDEO_STORAGE_ENDPOINT — account S3 endpoint, e.g. https://<account-id>.r2.cloudflarestorage.com
- VIDEO_STORAGE_BUCKET — private bucket name
- VIDEO_STORAGE_ACCESS_KEY_ID
- VIDEO_STORAGE_SECRET_ACCESS_KEY
- VIDEO_STORAGE_REGION — optional; defaults to `auto`

R2 currently includes 10 GB-month standard storage in its free tier. Above that, standard storage is billed per GB-month. Egress to the public Internet is free. Actual monthly cost depends on total stored GB, operation class and region. There is no unlimited free 1,000-video plan.

The app uses private objects and short-lived signed URLs. Original masters and watermarked renditions are stored under separate keys. The admin upload flow generates the watermarked MP4 in the browser using Canvas and MediaRecorder; it requires current Chrome or Edge on desktop and an open tab until processing finishes. This is not server-side transcoding. Never make the bucket public.

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

## OmniRoute AI gateway

All VICEHUB AI features (creator captions, agent tasks and translations) call the OpenAI-compatible OmniRoute Chat Completions endpoint. Do not add direct provider API calls to feature code.

Required Base44 secrets:

- OMNIROUTE_BASE_URL — the OmniRoute API root ending in /v1 (not the /chat/completions path)
- OMNIROUTE_API_KEY — a server-side OmniRoute key
- OMNIROUTE_MODEL — optional default model identifier; defaults to auto

The app calls POST <OMNIROUTE_BASE_URL>/chat/completions with Authorization: Bearer. Provider-specific account OAuth and publishing are deliberately kept outside OmniRoute.

## Social platform APIs

The app must be registered with each platform, the relevant products/scopes approved, and each creator must authorize their own account. Do not collect platform passwords. The OAuth callback URL for every provider is:

https://gta6-creator-hub-c26cc578.base44.app/social

Required Base44 secrets:

- TikTok: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
- Instagram and Facebook Pages (Meta): META_APP_ID, META_APP_SECRET
- YouTube: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- X: X_CLIENT_ID, X_CLIENT_SECRET
- LinkedIn: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET (member OAuth; request openid, profile and w_member_social)
- Token security: SOCIAL_TOKEN_ENCRYPTION_KEY, SOCIAL_OAUTH_STATE_SECRET (each at least 32 characters)

The app stores encrypted access/refresh tokens in the SocialAccount entity. Client-side entity reads are denied; server functions return only account names, scopes and connection status. OAuth state is short-lived, single-use and tied to the signed-in user. Disconnecting an account erases its stored credentials.

Supported initial publishing paths:
- Instagram: Reels video publishing to a linked Instagram professional account.
- Facebook: video publishing to a Facebook Page, not a personal profile.
- TikTok: video publishing through Content Posting API; TikTok must approve the app and verify the source domain for PULL_FROM_URL.
- YouTube: video upload to the selected channel (initial upload size limit 250 MB).
- X: text posts only; X video upload is not enabled.
- LinkedIn: text posts to the authorised member profile through the Posts API; media publishing is not enabled in this release. The LinkedIn app must have the relevant Community Management API access and the member must grant w_member_social.

A free GitHub Actions workflow (`.github/workflows/social-publisher-cron.yml`) calls the protected publisher endpoint every five minutes. Because this repository is public, the workflow uses GitHub's public-repository Actions allowance and does not depend on Base44 workflow execution credits. To activate it, generate one random secret of at least 32 characters and save the exact same value in Base44 secrets and GitHub repository Settings → Secrets and variables → Actions as `SOCIAL_PUBLISHER_CRON_SECRET`. The endpoint and backend function both validate this secret; the worker also accepts authenticated admin invocations. If the secret is missing, the GitHub job skips safely. The Base44 five-minute workflow remains inactive because its test run was rejected with `insufficient_credits`. Until the GitHub secret is configured, users can publish immediately or manually process due posts from the Social Planner. A scheduled post is only considered published after the provider confirms publication. TikTok requests remain in a processing state after the API accepts them.

Adding credentials alone does not activate a platform: configure the exact callback URL in each developer console, complete app review, enable the requested scopes and confirm the connected account is eligible. TikTok's unaudited applications may be restricted to private-only posts and must not be represented as publicly publish-ready.

## Rights and media policy

Do not publish Rockstar / Take-Two game assets or footage for a paid subscription service without written commercial distribution rights. The platform must retain the rights evidence and source reference for every video. A rights checkbox is an internal workflow control, not a licence.

## Deployment workflow

All application changes are committed through GitHub branches and pull requests. After merge, the app is synced and deployed through the Base44 REST API. No Base44 Builder credits, Sandbox Bridge or VPS are used.
