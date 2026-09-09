import { timingSafeEqual } from "crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTweetsMcpServer } from "@/lib/mcp/server";

function equal(value: string | undefined, expected: string | undefined) { return Boolean(value && expected && value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected))); }
function authorized(request: Request, capability?: string) { const header=request.headers.get("authorization"); return (header?.startsWith("Bearer ") && equal(header.slice(7),process.env.AGENT_MCP_TOKEN)) || equal(capability,process.env.MCP_WEB_CAPABILITY); }
export async function handleMcpRequest(request: Request, capability?: string) { if(!authorized(request, capability)) return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"WWW-Authenticate":"Bearer","content-type":"application/json"}}); const server=createTweetsMcpServer(); const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true}); await server.connect(transport); try { return await transport.handleRequest(request); } finally { await transport.close(); await server.close(); } }
