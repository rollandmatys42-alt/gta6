# GTA6 Creator Hub — foundation

## Product scope
An independent, English-first creator platform for GTA VI footage discovery, short-form creator workflows, editorial news, community and a Premium creator marketplace.

## Technical direction
- Base44 TanStack Start app (React, JavaScript/JSX), managed by Base44.
- GitHub repository is the source-controlled project record.
- Base44 Platform API is used to create the blank app, write approved source files, and publish. No Builder AI turns or integration-credit actions are used.
- Authentication, data entities, backend functions, Stripe and video storage are separate implementation milestones. UI copy must not imply those integrations are live until verified.

## Initial commercial assumptions (configurable before launch)
- Free: 5 video downloads per calendar month.
- Paid tiers: Starter, Pro and Premium; pricing, download limits and features must be configurable in admin.
- Loyalty: subscription price decreases after each uninterrupted paid month, down to an admin-configured floor. A voluntary cancellation followed by resubscription resets to the starting price. Failed payment grace periods must not count as voluntary cancellations.
- Currency display: USD, EUR and GBP. Display conversion is not a promise of the checkout settlement currency.

## Required safeguards
- Server-side monthly download entitlement checks and server-rendered watermarking for Free downloads.
- Original video files private; signed, expiring delivery URLs only.
- Per-user access control and tenant isolation for all account, billing, downloads and marketplace records.
- Official TikTok/Instagram publishing APIs only; manual publishing fallback where their APIs do not permit the requested action.
- News must distinguish official statements, reputable media, community reports, rumours, leaks and theories. Link to sources; do not republish full protected articles or unlicensed imagery.
- No Rockstar / Take-Two branding, artwork, music or screenshots without permission. Include an independent-platform disclaimer and a copyright/takedown process.

## Delivery milestones
1. Foundation UI and responsive design.
2. Authentication, roles, user profiles and admin console.
3. Video ingestion, private storage, entitlements, download tracking and watermark pipeline.
4. Subscription billing, loyalty ledger and cancellation handling.
5. News ingestion, moderation and source labels.
6. AI creator tools with provider routing, quotas and cost controls.
7. Marketplace, seller onboarding, commissions and payouts.
8. Social account OAuth and supported publishing workflows.
9. GDPR/UK GDPR compliance, security tests, SEO, PWA and production QA.
