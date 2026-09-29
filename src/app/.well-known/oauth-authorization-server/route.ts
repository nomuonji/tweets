import { oauthMetadata, oauthOrigin } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(oauthMetadata(oauthOrigin(request)), {
    headers: { "cache-control": "no-store" },
  });
}
