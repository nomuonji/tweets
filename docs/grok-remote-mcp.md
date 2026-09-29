# Grok / xAI Remote MCP connection

## Grok Custom Connector UI (OAuth PKCE)

If the Grok UI shows **OAuth Credentials Required**, use these values:

```text
Client ID: groq
Client Secret: (leave blank)
Authorization Endpoint: https://tweets-lime.vercel.app/oauth/authorize
Token Endpoint: https://tweets-lime.vercel.app/oauth/token
Scopes: tweets-operator
Token Auth Method: none (PKCE only)
```

The Client ID is only used as the OAuth client identifier; this server does not require a registered client secret.

After **Save & Connect**, the browser is redirected to Tweets Operator's authorization page. Enter the existing `AGENT_MCP_TOKEN` as the access key there. The token is used only to approve the OAuth grant; the connector receives a short-lived OAuth access token and refresh token rather than the raw `AGENT_MCP_TOKEN`.

OAuth discovery metadata is also published at:

```text
https://tweets-lime.vercel.app/.well-known/oauth-authorization-server
https://tweets-lime.vercel.app/.well-known/oauth-protected-resource
```


Tweets Operator exposes a stateless Streamable HTTP MCP endpoint:

```text
https://tweets-lime.vercel.app/api/mcp
```

The endpoint keeps the existing agent authentication and adds explicit Grok-compatible static authentication.

## Authentication

Accepted credentials:

1. `Authorization: Bearer <AGENT_MCP_TOKEN>`
2. `Authorization: Bearer <TWEETS_GROK_MCP_TOKEN>`
3. `x-api-key: <TWEETS_GROK_MCP_TOKEN>`
4. legacy capability URL authentication through `MCP_WEB_CAPABILITY`

If `TWEETS_GROK_MCP_TOKEN` is not configured, Grok authentication falls back to `AGENT_MCP_TOKEN`.

This allows a dedicated Grok token to be introduced later without rotating or breaking existing agents.

Never commit either token to Git, Firestore, prompts, article metadata, or screenshots.

## Grok CLI

xAI's Grok CLI supports static headers for remote HTTP MCP servers.

Bearer form:

```bash
grok mcp add --transport http tweets-operator https://tweets-lime.vercel.app/api/mcp \
  --header "Authorization: Bearer ${TWEETS_GROK_MCP_TOKEN}"
```

Or with `x-api-key`:

```bash
grok mcp add --transport http tweets-operator https://tweets-lime.vercel.app/api/mcp \
  --header "x-api-key: ${TWEETS_GROK_MCP_TOKEN}"
```

Then verify:

```bash
grok mcp doctor tweets-operator
```

## Grok / xAI Responses API

Use Tweets Operator as a remote MCP tool:

```json
{
  "type": "mcp",
  "server_url": "https://tweets-lime.vercel.app/api/mcp",
  "server_label": "tweets_operator",
  "server_description": "Manage X and Threads accounts, drafts, publishing, affiliate distribution, owned-content distribution, and operator context.",
  "authorization": "Bearer <TWEETS_GROK_MCP_TOKEN>"
}
```

xAI sends the `authorization` value as the HTTP `Authorization` header value, so include the `Bearer ` prefix explicitly.

If the client/runtime supports custom MCP headers, this is also valid:

```json
{
  "type": "mcp",
  "server_url": "https://tweets-lime.vercel.app/api/mcp",
  "server_label": "tweets_operator",
  "headers": {
    "x-api-key": "<TWEETS_GROK_MCP_TOKEN>"
  }
}
```

## Access control

Tweets Operator exposes write-capable tools, including draft creation, publishing, account updates, affiliate offer mutation, and project-context mutation.

For autonomous Grok workflows, prefer `allowed_tools` when the job only needs a subset of capabilities.

Examples:

### Read/research only

```json
"allowed_tools": [
  "get_system_health",
  "list_accounts",
  "get_account",
  "get_generation_work",
  "list_recent_posts",
  "get_project_context",
  "list_products",
  "get_product_discovery_work",
  "get_product_performance_work",
  "get_owned_content_distribution_work"
]
```

### Draft generation without publishing

Add:

```text
create_drafts
update_draft
```

Do not expose `publish_draft`, `update_account`, or destructive/archive tools to a workflow that does not need them.

## Verification

The repository runs `npm run test:mcp-auth` before production builds. It verifies:

- legacy agent Bearer auth
- dedicated Grok Bearer auth
- Grok `x-api-key` auth
- capability URL auth
- rejection of wrong credentials
- fallback to `AGENT_MCP_TOKEN` when no dedicated Grok token is configured

`get_system_health` reports only safe configuration flags; it never returns token values.
