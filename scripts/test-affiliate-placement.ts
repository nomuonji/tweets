import assert from "node:assert/strict";
import {checkCanonicalPlacement,checkPublicLpReady} from "@/lib/services/affiliate-placement-service";
import type {AffiliateOfferRecord} from "@/lib/affiliate-distribution-policy";

const base: AffiliateOfferRecord = {
  id:"test",kind:"service",network:"A8.net",title:"sample",status:"active",
  programId:"s00000012624008",a8PlacementSiteId:"015",
  affiliateUrl:"https://bloom.antonbase.com/uranai-chat-soudan/",
  revision:1,created_at:"2026-10-13",updated_at:"2026-10-13",
} as AffiliateOfferRecord;
const goodHtml = '<html><body><p>PR（広告）</p><a href="https://px.a8.net/svt/ejp?a8mat=test">Details</a></body></html>';
const previousFetch=globalThis.fetch;
const previousUrl=process.env.AFFILIATE_POLICY_API_URL;
const previousToken=process.env.AFFILIATE_POLICY_READ_TOKEN;
const previousAdmin=process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
function publicPage(html=goodHtml,status=200,url=base.affiliateUrl) {
  const response=new Response(html,{status,headers:{"content-type":"text/html"}});
  Object.defineProperty(response,"url",{value:url});
  return response;
}
async function run(){
  delete process.env.AFFILIATE_POLICY_API_URL;
  delete process.env.AFFILIATE_POLICY_READ_TOKEN;
  delete process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
  globalThis.fetch=async()=>publicPage();
  assert.equal((await checkCanonicalPlacement(base)).allowed,true,
    "LP-ready pilot must work with canonical service offline");

  globalThis.fetch=async()=>publicPage('<html><body>No disclosure <a href="https://px.a8.net/track">Link</a></body></html>');
  assert.deepEqual((await checkPublicLpReady(base.affiliateUrl!)).reasons,["lp_disclosure_missing"]);
  globalThis.fetch=async()=>publicPage("<html>PR（広告） but no CTA</html>");
  assert.deepEqual((await checkPublicLpReady(base.affiliateUrl!)).reasons,["lp_affiliate_cta_missing"]);
  globalThis.fetch=async()=>publicPage("unavailable",404);
  assert.deepEqual((await checkPublicLpReady(base.affiliateUrl!)).reasons,["lp_not_public_200"]);
  assert.deepEqual((await checkPublicLpReady("https://evil.example/")).reasons,["lp_url_invalid"]);

  // Explicit prohibits still block; unknown and pending media review warn only.
  process.env.AFFILIATE_POLICY_API_URL="https://consult.antonbase.com/api/placement-eligibility";
  process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN="owner-token";
  let canonicalHits=0;
  globalThis.fetch=async(input,options)=>{
    if(String(input).includes("/api/placement-eligibility")){
      canonicalHits++;
      assert.equal(new Headers(options?.headers).get("authorization"),"Bearer owner-token");
      const url=new URL(String(input));
      assert.equal(url.searchParams.get("programId"),base.programId);
      assert.equal(url.searchParams.get("siteId"),base.a8PlacementSiteId);
      return new Response(JSON.stringify({programId:base.programId,siteId:base.a8PlacementSiteId,
        channel:"sns",allowed:false,reasons:["site_conditions_needs_review","sns_permission_unknown"]}),
        {status:200,headers:{"content-type":"application/json"}});
    }
    return publicPage();
  };
  const advisory=await checkCanonicalPlacement(base);
  assert.equal(advisory.allowed,true);
  assert.deepEqual(advisory.reasons,[]);
  assert.ok(advisory.warnings?.includes("sns_permission_unknown"));
  assert.equal(canonicalHits,1);

  globalThis.fetch=async(input)=>{
    if(String(input).includes("/api/placement-eligibility"))
      return new Response(JSON.stringify({programId:base.programId,siteId:base.a8PlacementSiteId,
        channel:"sns",allowed:false,reasons:["sns_not_permitted","site_conditions_needs_review"]}),
        {status:200});
    return publicPage();
  };
  assert.deepEqual((await checkCanonicalPlacement(base)).reasons,["sns_not_permitted"]);
  globalThis.fetch=async(input)=>{
    if(String(input).includes("/api/placement-eligibility"))
      return new Response(JSON.stringify({error:"eligibility_unavailable"}),{status:503});
    return publicPage();
  };
  const duringQuota=await checkCanonicalPlacement(base);
  assert.equal(duringQuota.allowed,true);
  assert.ok(duringQuota.warnings?.includes("canonical_policy_http_503"));

  // Bloom media 015 URLs must match the currently issued A8 creative exactly.
  for (const entry of [
    {
      id:"BA0Wz65EVGpOXBOk7AHZ",
      programId:"s00000011537001",
      lpUrl:"https://bloom.antonbase.com/uranai-soudan/",
      cta:"https://px.a8.net/svt/ejp?a8mat=45IGP4+7GITEQ+2H0Q+661TT",
    },
    {
      id:"BFTZwJaQ07PGzGycS1bg",
      programId:"s00000012624002",
      lpUrl:"https://bloom.antonbase.com/uranai-denwa-soudan/",
      cta:"https://px.a8.net/svt/ejp?a8mat=3B9EG8+6LK9YA+2PEO+C5GGH",
    },
  ]) {
    const offer={...base,id:entry.id,programId:entry.programId,affiliateUrl:entry.lpUrl};
    const policyResponse=()=>new Response(JSON.stringify({
      programId:entry.programId,siteId:"015",channel:"sns",
      allowed:false,reasons:["site_conditions_needs_review"],
    }),{status:200,headers:{"content-type":"application/json"}});
    globalThis.fetch=async input=>String(input).includes("/api/placement-eligibility")
      ? policyResponse()
      : publicPage('<html>PR（広告）<a href="'+entry.cta+'">Go</a></html>',200,entry.lpUrl);
    assert.equal((await checkCanonicalPlacement(offer)).allowed,true,
      "valid LP with its A8 canonical creative may enter the LP-first pilot");

    globalThis.fetch=async input=>String(input).includes("/api/placement-eligibility")
      ? policyResponse()
      : publicPage('<html>PR（広告）<a href="https://px.a8.net/svt/ejp?a8mat=WRONG">Go</a></html>',200,entry.lpUrl);
    assert.deepEqual((await checkCanonicalPlacement(offer)).reasons,["lp_cta_mismatch_known"],
      "unexpected A8 creative must still block placement");
    assert.deepEqual((await checkCanonicalPlacement({...offer,a8PlacementSiteId:"016"})).reasons,
      ["lp_cta_mismatch_known"],"wrong registered site identity must block");
  }
  console.log("LP-first A8 placement pilot tests passed.");
}
run().finally(()=>{
  globalThis.fetch=previousFetch;
  if(previousUrl===undefined)delete process.env.AFFILIATE_POLICY_API_URL;
  else process.env.AFFILIATE_POLICY_API_URL=previousUrl;
  if(previousToken===undefined)delete process.env.AFFILIATE_POLICY_READ_TOKEN;
  else process.env.AFFILIATE_POLICY_READ_TOKEN=previousToken;
  if(previousAdmin===undefined)delete process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
  else process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN=previousAdmin;
}).catch(e=>{console.error(e);process.exitCode=1});
