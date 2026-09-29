import { timingSafeEqual } from "crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTweetsMcpServer } from "@/lib/mcp/server";

function equal(value: string | undefined | null, expected: string | undefined | null) {
  return Boolean(
    value &&
    expected &&
    value.length === expected.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

export function isMcpRequestAuthorized(request: Request, capability?: string) {
  const agentToken = process.env.AGENT_MCP_TOKEN?.trim() || null;
  const dedicatedGrokToken = process.env.TWEETS_GROK_MCP_TOKEN?.trim() || null;
  const grokToken = dedicatedGrokToken ?? agentToken;
  const bearer = bearerToken(request);
  const apiKey = request.headers.get("x-api-key")?.trim() || null;

  return (
    equal(bearer, agentToken) ||
    equal(bearer, grokToken) ||
    equal(apiKey, grokToken) ||
    equal(capability, process.env.MCP_WEB_CAPABILITY)
  );
}

export async function handleMcpRequest(request: Request, capability?: string) {
  if (!isMcpRequestAuthorized(request, capability)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "WWW-Authenticate": "Bearer",
        "content-type": "application/json",
      },
    });
  }

  const server = createTweetsMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}
