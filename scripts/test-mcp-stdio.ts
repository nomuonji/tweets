/**
 * End-to-end check for the local stdio MCP surface.
 *
 * Spawns scripts/mcp-stdio.ts the same way the DSH connection does (tsx CLI entry,
 * repo cwd), performs a real MCP handshake, lists tools, and calls the read-only
 * health tool. Fails loudly on any protocol or Firestore problem instead of only
 * proving that the process starts.
 */

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = process.cwd();
const TSX_CLI = path.join(repoRoot, "node_modules/tsx/dist/cli.mjs");
const ENTRY = path.join(repoRoot, "scripts/mcp-stdio.ts");

async function main() {
  // Absolute paths mirror the DSH connection config exactly.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX_CLI, ENTRY],
    cwd: repoRoot,
    env: process.env as Record<string, string>,
    stderr: "inherit",
  });

  const client = new Client({ name: "local-stdio-verification", version: "1.0.0" });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    if (tools.length < 40) throw new Error(`expected the full tool surface, got ${tools.length} tools.`);
    console.log(`tools: ${tools.length}`);

    const health = await client.callTool({ name: "get_system_health", arguments: {} });
    const content = (health as { content?: Array<{ type: string; text?: string }> }).content;
    const payload = content?.[0];
    if (payload?.type !== "text" || typeof payload.text !== "string") {
      throw new Error("get_system_health did not return text content.");
    }
    const parsed = JSON.parse(payload.text) as { status?: string; accounts?: number; serverVersion?: string };
    if (parsed.status !== "ok") throw new Error(`unexpected health status: ${String(parsed.status)}`);

    console.log(`health: status=${parsed.status} accounts=${parsed.accounts} version=${parsed.serverVersion}`);
    console.log("local stdio MCP is reachable and authorized against Firestore.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
