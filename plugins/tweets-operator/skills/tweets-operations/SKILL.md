---
name: tweets-operations
description: Operate the authenticated Tweets MCP service to diagnose draft inventory, create compliant current-version drafts, and manage post operations safely.
---

# Tweets operations

Use this skill when operating the configured Tweets MCP server.

Start with `get_system_health`, then call `get_generation_work` for every auto-post-enabled account. A usable inventory includes only `draft` or `scheduled` items whose `character_version` equals the account's current version.

When drafts are needed, author the text yourself. Do not call paid text-generation APIs. Call `create_drafts` with the exact `expectedCharacterVersion`, no more than the reported `neededCount`, and a fresh idempotency key. Re-run `get_generation_work` after saving.

Never publish arbitrary text. `publish_draft` is only for a reviewed, already-saved draft and requires its current `updated_at`. Treat it as an external side effect. Scheduled replenishment must never call it.

For every mutation, first read the record to obtain its concurrency value. Use a new idempotency key for a genuinely new operation; reuse the same key only to retry the same operation. Do not expose credentials or request them in tool arguments.

If the server reports a version conflict, duplicate, similarity warning, authentication error, or provider degradation, stop that affected action and report the account ID and the next required human action.
