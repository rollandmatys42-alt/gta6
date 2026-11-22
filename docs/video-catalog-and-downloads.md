# Video catalogue and download control

- Video records are private metadata; only verified, published catalogue fields are exposed by the public server function.
- Original and watermarked renditions are stored in a private S3-compatible bucket (Cloudflare R2 supported). The app issues short-lived signed URLs only after authorization.
- Free accounts receive five downloads per UTC calendar month. Paid tier limits and clean-download entitlement come from active SubscriptionPlan records; no paid prices or limits are invented.
- Free accounts are served only the separately prepared watermarked rendition. Publishing requires both private renditions and verified content rights.
- Admin-only upload URL, draft creation and publish functions are server-side and check the Base44 admin role.
- Required Base44 secrets: VIDEO_STORAGE_ENDPOINT, VIDEO_STORAGE_BUCKET, VIDEO_STORAGE_ACCESS_KEY_ID, VIDEO_STORAGE_SECRET_ACCESS_KEY, VIDEO_STORAGE_REGION (usually auto).

## Release gates

- R2 bucket CORS must allow the published admin origin to PUT video/mp4 and video/quicktime uploads.
- Watermarked renditions must be generated and uploaded before publication. This foundation does not generate a watermark/transcode itself.
- Monthly quota uses a conditional atomic increment after a quota row exists. First-time concurrent quota-row creation and full end-to-end load/race testing remain required before commercial launch.
- Signed download URLs expire after 120 seconds; they are not persistent public URLs.
