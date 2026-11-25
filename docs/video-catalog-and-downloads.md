# Video catalogue and download control

- Video records are private metadata; only verified, published catalogue fields are exposed by the public server function.
- Original and watermarked renditions are stored in a private S3-compatible bucket (Cloudflare R2 supported). The app issues short-lived signed URLs only after authorization.
- Free accounts receive five downloads per UTC calendar month. Paid tier limits and clean-download entitlement come from active SubscriptionPlan records; no paid prices or limits are invented.
- The active tier is stored in the admin-managed UserSubscription entity, separate from Base44's built-in User record.
- Free accounts are served only the separately prepared watermarked rendition. Publishing requires both private renditions and verified content rights.
- Admin-only upload URL, draft creation and publish functions are server-side and check the Base44 admin role.
- Required Base44 secrets: VIDEO_STORAGE_ENDPOINT, VIDEO_STORAGE_BUCKET, VIDEO_STORAGE_ACCESS_KEY_ID and VIDEO_STORAGE_SECRET_ACCESS_KEY. VIDEO_STORAGE_REGION is optional and defaults to `auto`.

## Release gates

- R2 bucket CORS must allow the published admin origin to PUT video/mp4 and video/quicktime uploads.
- The admin upload flow generates a watermarked MP4 in the browser using Canvas and MediaRecorder, then uploads both the clean master and watermarked rendition to private R2. Use current Chrome or Edge on desktop and keep the tab open until processing finishes. This is browser-side rendering, not a server-side transcoding service; a managed server-side pipeline remains necessary for robust high-volume processing.
- Monthly quota uses a conditional atomic increment after a quota row exists. First-time concurrent quota-row creation and full end-to-end load/race testing remain required before commercial launch.
- Signed download URLs expire after 120 seconds; they are not persistent public URLs.


## Client catalogue discovery

The public catalogue supports server-side filtering by category, language and text/tag search, plus duration ranges (under 1 minute, 1–5, 5–15, over 15 minutes) and sorting by newest, oldest, shortest or longest. Pagination is retained. Only published videos with verified rights are returned. Preview and download delivery continue through VICEHUB routes; the storage provider URL is not exposed to the client.
