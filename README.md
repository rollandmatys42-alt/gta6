# VICEHUB

VICEHUB is a multi-platform video processing and clip-library platform. Administrators import video URLs, the processing worker analyses and transcribes accessible sources, AI proposes metadata and short-form clip candidates, and the resulting clips are stored in Google Drive for review and controlled client access.

## Core workflow

1. Administrator imports a source URL from the VICEHUB administration interface.
2. The server records the source and queues processing.
3. The VPS worker uses FFmpeg, FFprobe, Whisper and yt-dlp-supported extractors to retrieve and analyse accessible video sources.
4. Base44 queues transcription and calls OmniRoute for clip selection and metadata generation.
5. FFmpeg renders the selected clips and the worker uploads them to Google Drive.
6. Administrators review and publish the resulting assets to the client library.

The source connectors are extensible and are not restricted to a fixed list of platforms. Access controls, DRM, authentication and provider restrictions are not bypassed; sources that cannot be accessed by an available connector are reported as failed rather than marked successful.

## Architecture

- **Base44:** application UI, authentication, administration, metadata, job queue, client library and access control.
- **VPS worker:** sequential video extraction, media probing, transcription, FFmpeg rendering and temporary file handling.
- **OmniRoute:** AI-based clip selection, titles, descriptions, categories, language, target markets, tags and predicted viral-potential scoring.
- **Google Drive API:** durable video storage and integrity verification.

Secrets and provider credentials must be configured in Base44 or the worker's protected environment. Never commit credentials to this repository.

## Development

The application uses React, TanStack Start/Router and Base44 backend services. The worker is a Python/FastAPI Docker service. Run the repository's GitHub Actions checks before merging changes. Production app changes are synchronised and deployed through the Base44 REST API; do not use Builder or integration-credit workflows.
## VICEHUB Store

The native Base44 storefront at `/shop` supports physical and digital catalogue items, a shopping bag, customer order history, private digital delivery, inventory and fulfilment management. Store administrators manage coupons, returns, invoices and sales reports under `/admin/shop/operations`. Coupon rules are validated server-side and applied to Stripe Checkout when payment prerequisites are configured. Stripe checkout remains deliberately disabled until the merchant completes Stripe, signed webhooks and tax configuration; do not represent the store as accepting live payments before those checks pass.
