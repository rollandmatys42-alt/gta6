# AGENTS.md

## Mandatory zero Base44 credit policy

- Never use Base44 AI builder messages or credit-consuming integration endpoints. Use GitHub, direct code changes, and the documented deployment API/CLI.
- Use direct provider APIs and account-owned services for AI, email, storage, media, OCR and transcription. No metered Base44 Core integrations or connector gateways.
- If a direct provider is unavailable, fail closed with an actionable error; never fall back to metered Base44 services. Preserve access control, data and business logic. Third-party fees are separate.
- Audit new runtime code paths and run no-credit regression tests before publishing. Verify actual usage before claiming zero credits.

## Strict zero-credit architecture — November 2026

- Base44's official credits guide (https://docs.base44.com/Account-and-billing/Credits) states that hosted backend invocations, workflow steps and external coding-agent CLI/MCP file operations can consume integration credits. Do not assume a direct API, CLI, scheduler or external AI key makes the Base44 runtime free.
- For a strict zero-Base44-credit release, edit and test from GitHub or external infrastructure, and move metered server processing and scheduling to externally hosted services. Do not use metered Base44 coding tools, native AI/chat, native integrations or metered backend/workflow execution as a fallback. Preserve authentication, access control and existing records; migrate deliberately before switching live traffic.
- Verify actual billing and deployment behavior separately. Do not certify zero credits merely because a static Core-integration scan passes. Do not purchase credits or change the workspace plan without explicit approval.
