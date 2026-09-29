import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTweetsMcpServer } from "@/lib/mcp/server";
import { isMcpRequestAuthorized } from "@/lib/mcp/auth";

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
