# VICEHUB internal video library

## Scope

This is an administrator-only workspace for VICEHUB staff. Assets are private by default. An administrator can explicitly publish an authorised asset to the public Video catalogue from its card after VICEHUB creates a protected watermarked rendition.

- Store original source footage, selected clips and derivative assets.
- Keep media objects in private storage and metadata in the InternalVideoAsset entity.
- Preview private assets through an authenticated, admin-only streaming route.
- Archive records without deleting the underlying object.
- Publish authorised assets to the client catalogue without re-uploading the original master. The public Video record points to the private original object and a separately generated watermarked rendition.
- Preserve source URL, rights status and evidence reference.
- Do not add a commercial watermark to internal assets.

## Storage

The first integration reuses VICEHUB's encrypted multi-account S3-compatible storage connections (Cloudflare R2 and other S3-compatible services). When the optional VICEHUB allocation is blank, VICEHUB does not apply an artificial capacity cap; provider quotas, API limits and billing remain applicable.

Google Drive, OneDrive, Dropbox, MEGA and other non-S3 providers require separate official API/OAuth adapters and are not represented as connected until implemented and tested.

## Upload path

1. Admin requests a short-lived signed PUT URL.
2. The browser uploads the original MP4 or MOV directly to the selected private storage account.
3. A server function validates the storage account and creates the private asset record.
4. The authenticated preview route streams the object and forwards HTTP range headers.

The first upload path accepts MP4 and MOV. Larger single-request uploads remain subject to the selected provider's API limits; multipart upload is a separate enhancement.

## Processing status

This release implements ingestion, private storage, metadata, rights provenance, preview, archive and explicit publication of authorised assets to the client catalogue. Publication creates the watermarked MP4 in the administrator's browser and keeps the original master unchanged. It does not claim that AI clip selection, transcription or FFmpeg rendering is live. Those jobs require the separate VICEHUB worker service based on the audited OpenShorts engine, with a queue and a secure callback/API into this application.

## Security

- Every server function checks the authenticated user's admin role.
- The entity applies admin-only row-level security to read, create, update and delete.
- Media preview checks the admin role and asset path before proxying from private storage.
- Storage credentials remain encrypted in the existing server-side storage connection mechanism.
- External source URLs are saved as provenance only; the module does not download YouTube content.
