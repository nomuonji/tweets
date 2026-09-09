import fs from "node:fs";
const token = fs.readFileSync(process.argv[2], "utf8").trim();
const endpoint = "https://tweets-lime.vercel.app/api/mcp";
let id = 1;
async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" }, body: JSON.stringify({ jsonrpc:"2.0", id:id++, method:"tools/call", params:{ name, arguments:args } }) });
  const json = await response.json() as { result?: { content?: Array<{ text?: string }> }; error?: unknown };
  if (!response.ok || !json.result) throw new Error(`${name}: ${JSON.stringify(json.error ?? json)}`);
  return JSON.parse(json.result.content?.[0]?.text ?? "{}");
}
async function main() {
  await fetch(endpoint, { method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"}, body:JSON.stringify({jsonrpc:"2.0",id:0,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"replenish","version":"1"}}}) });
  const accounts = await call("list_accounts", { page:1, limit:50 });
  for (const account of accounts.items.filter((item: { autoPostEnabled?: boolean }) => item.autoPostEnabled)) {
    const work = await call("get_generation_work", { accountId: account.id });
    if (work.neededCount > 0) console.log(JSON.stringify({ account, work }));
  }
}
main().catch((error) => { console.error(error); process.exitCode=1; });
