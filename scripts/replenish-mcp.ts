import fs from "node:fs";
import crypto from "node:crypto";
const token = fs.readFileSync(process.argv[2], "utf8").trim();
const endpoint = "https://tweets-lime.vercel.app/api/mcp";
let id = 1;
async function tool(name: string, args: Record<string, unknown>) {
  const res = await fetch(endpoint, { method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-03-26"}, body:JSON.stringify({jsonrpc:"2.0",id:id++,method:"tools/call",params:{name,arguments:args}}) });
  const json = await res.json() as { result?: { content?: Array<{text?:string}> }; error?:unknown };
  if (!res.ok || !json.result) throw new Error(JSON.stringify(json.error));
  return JSON.parse(json.result.content?.[0]?.text ?? "{}");
}
async function main() {
  await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:0,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"replenisher",version:"1"}}})});
  const accountId="threads_uwaki_neko_xx";
  const work=await tool("get_generation_work",{accountId});
  const drafts=[
    "浮気って、体の関係があったかより\n相手に隠す必要があることをしたかだと思う。\n\n隠してる時点で、もう相手の安心を削ってる。",
    "恋人のスマホを見たくなる時って\n疑ってる自分が嫌なんじゃなくて、\n安心させてもらえてない自分がしんどいんだと思う。",
    "『もう終わったことだから』って言われると余計しんどい。\n傷ついた側は、終わったかどうかをまだ決められてないから。",
    "浮気された後に一番きついの、相手の行動より\n自分が信じてた時間まで全部疑わしく見えることかもしれない。",
    "恋人に言えない不満がある人、どの段階で言う？\n小さいうちに言う派か、我慢が限界になってから言う派か普通に気になる。"
  ].slice(0,work.neededCount);
  const result=await tool("create_drafts",{accountId,expectedCharacterVersion:work.characterVersion,drafts:drafts.map(text=>({text:`${text}\n\nこれ、傷ついた側だけが気にしすぎってことにされがち。\n信頼を戻す話は、まずここを曖昧にしないでほしい。`})),idempotencyKey:crypto.randomUUID()});
  const after=await tool("get_generation_work",{accountId});
  console.log(JSON.stringify({saved:result.drafts?.length ?? 0,after},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1});
