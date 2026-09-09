import fs from "node:fs";

const environmentFile = process.argv[2];
if (!environmentFile) throw new Error("Environment file path is required.");
const rawSecret = fs.readFileSync(environmentFile, "utf8").trim();
const match = rawSecret.match(/^AGENT_MCP_TOKEN="?([^"\r\n]+)"?$/m);
const token = match?.[1] ?? rawSecret;
if (!token) throw new Error("AGENT_MCP_TOKEN was not found.");

const endpoint = "https://tweets-lime.vercel.app/api/mcp";
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "MCP-Protocol-Version": "2025-03-26",
};

const call = async (id: number, method: string, params: Record<string, unknown>) => {
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ result?: { tools?: Array<{ name: string }> } }>;
};

async function main() {
  await call(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "vercel-cli-verification", version: "1.0" } });
  const tools = await call(2, "tools/list", {});
  console.log(`MCP verified: ${tools.result?.tools?.length ?? 0} tools available.`);
  console.log(tools.result?.tools?.map((tool) => tool.name).join(", "));
  const health = await call(3, "tools/call", { name: "get_system_health", arguments: {} });
  console.log(`Health tool verified: ${JSON.stringify(health.result)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
