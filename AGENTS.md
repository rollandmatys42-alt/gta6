# AGENTS.md

## Mandatory zero Base44 credit policy

- Never use Base44 AI builder messages or credit-consuming integration endpoints. Use GitHub, direct code changes, and the documented deployment API/CLI.
- Use direct provider APIs and account-owned services for AI, email, storage, media, OCR and transcription. No metered Base44 Core integrations or connector gateways.
- If a direct provider is unavailable, fail closed with an actionable error; never fall back to metered Base44 services. Preserve access control, data and business logic. Third-party fees are separate.
- Audit new runtime code paths and run no-credit regression tests before publishing. Verify actual usage before claiming zero credits.
