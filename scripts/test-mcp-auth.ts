import { strict as assert } from "node:assert";
import { isMcpRequestAuthorized } from "../src/lib/mcp/auth";

const old = {
  agent: process.env.AGENT_MCP_TOKEN,
  grok: process.env.TWEETS_GROK_MCP_TOKEN,
  capability: process.env.MCP_WEB_CAPABILITY,
};

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/mcp", { headers });
}

try {
  process.env.AGENT_MCP_TOKEN = "agent-secret";
  process.env.TWEETS_GROK_MCP_TOKEN = "grok-secret";
  process.env.MCP_WEB_CAPABILITY = "legacy-capability";

  assert.equal(isMcpRequestAuthorized(request({ Authorization: "Bearer agent-secret" })), true);
  assert.equal(isMcpRequestAuthorized(request({ Authorization: "Bearer grok-secret" })), true);
  assert.equal(isMcpRequestAuthorized(request({ "x-api-key": "grok-secret" })), true);
  assert.equal(isMcpRequestAuthorized(request(), "legacy-capability"), true);

  assert.equal(isMcpRequestAuthorized(request({ Authorization: "Bearer wrong" })), false);
  assert.equal(isMcpRequestAuthorized(request({ "x-api-key": "agent-secret" })), false);
  assert.equal(isMcpRequestAuthorized(request(), "wrong"), false);

  delete process.env.TWEETS_GROK_MCP_TOKEN;
  assert.equal(isMcpRequestAuthorized(request({ "x-api-key": "agent-secret" })), true);
  assert.equal(isMcpRequestAuthorized(request({ Authorization: "Bearer agent-secret" })), true);

  console.log("MCP auth compatibility verified.");
} finally {
  if (old.agent === undefined) delete process.env.AGENT_MCP_TOKEN; else process.env.AGENT_MCP_TOKEN = old.agent;
  if (old.grok === undefined) delete process.env.TWEETS_GROK_MCP_TOKEN; else process.env.TWEETS_GROK_MCP_TOKEN = old.grok;
  if (old.capability === undefined) delete process.env.MCP_WEB_CAPABILITY; else process.env.MCP_WEB_CAPABILITY = old.capability;
}
