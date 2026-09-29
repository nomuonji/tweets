import { oauthOrigin, oauthScope } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = oauthOrigin(request);
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [oauthScope()],
  }, {
    headers: { "cache-control": "no-store" },
  });
}
