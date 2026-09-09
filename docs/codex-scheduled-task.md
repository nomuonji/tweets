# Draft inventory replenishment

Create one recurring Codex task named `tweets-draft-replenishment` with this cron expression and timezone:

```text
30 4,10,16,22 * * *
Asia/Tokyo
```

Use this prompt:

> Use the configured `tweets-operator` MCP server. Start with `get_system_health`, then inspect `get_generation_work` for every auto-post-enabled account. If an account already has five usable drafts for its current character version, take no action. Otherwise write exactly the reported missing number of drafts yourself and save them with `create_drafts`, using the returned current character version and a fresh idempotency key. Recheck each changed account with `get_generation_work`. Never call `publish_draft` from this task and never call paid text-generation APIs. Stay quiet when every account is healthy and unchanged. Notify only for drafts successfully replenished, authentication failure, save failure, version conflict, or another condition requiring human action; include account IDs and the next action.
