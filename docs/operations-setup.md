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

Before checkout can open, activate a SubscriptionPlan record for each tier/currency and set a positive monthly price and monthly download limit. Draft plans are deliberately not purchasable. The checkout creates a monthly recurring Stripe price from the active plan configuration. Customers manage or cancel through the Stripe Billing Portal.

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
