/**
 * Local stdio entrypoint for the tweets-operator MCP server.
 *
 * The deployed server (src/app/api/mcp/route.ts) exposes the same tool surface over
 * Streamable HTTP and authenticates with AGENT_MCP_TOKEN. Running locally needs no
 * token: the process boundary is the trust boundary, and it reaches Firestore with
 * FIREBASE_SERVICE_ACCOUNT from .env, exactly like scripts/sync.ts does.
 *
 * Start it with the tsx CLI (see package.json "mcp:stdio"). Plain
 * `node --import tsx/esm` fails in this repo because package.json has no
 * "type": "module", which makes Node reject the CJS/ESM hand-off.
 *
 * Import order matters: env first, then the stdout guard, then the server graph.
 */

import "dotenv/config";
import "./mcp-stdio-silence-stdout";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTweetsMcpServer } from "../src/lib/mcp/server";

async function main() {
  const server = createTweetsMcpServer();
  const transport = new StdioServerTransport();

  const shutdown = async (signal: string) => {
    process.stderr.write(`[mcp-stdio] received ${signal}; shutting down.\n`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);
  process.stderr.write("[mcp-stdio] tweets-operator is listening on stdio.\n");
}

main().catch((error) => {
  process.stderr.write(`[mcp-stdio] failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
