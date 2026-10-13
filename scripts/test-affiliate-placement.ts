import assert from "node:assert/strict";
import { checkCanonicalPlacement } from "@/lib/services/affiliate-placement-service";
import type { AffiliateOfferRecord } from "@/lib/affiliate-distribution-policy";

const offer = {
  id: "test", kind:"service", network:"A8.net", title:"sample",
  status:"active", programId:"s00000011537001", a8PlacementSiteId:"015",
  affiliateUrl:"https://bloom.antonbase.com/uranai-soudan/",
  revision:1,created_at:"2026-10-13",updated_at:"2026-10-13",
} as AffiliateOfferRecord;
const previousUrl=process.env.AFFILIATE_POLICY_API_URL;
const previousToken=process.env.AFFILIATE_POLICY_READ_TOKEN;
const previousAdminToken=process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
const previousFetch=globalThis.fetch;
async function run(){
  delete process.env.AFFILIATE_POLICY_API_URL;
  delete process.env.AFFILIATE_POLICY_READ_TOKEN;
  delete process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
  assert.deepEqual((await checkCanonicalPlacement(offer)).reasons,["canonical_policy_connection_missing"]);
  process.env.AFFILIATE_POLICY_API_URL="https://consult.antonbase.com/api/placement-eligibility";
  process.env.AFFILIATE_POLICY_READ_TOKEN="sample-test-token";
  globalThis.fetch=async(input,options)=>{
    const u=new URL(String(input));
    assert.equal(u.searchParams.get("programId"),offer.programId);
    assert.equal(u.searchParams.get("siteId"),offer.a8PlacementSiteId);
    assert.equal(u.searchParams.get("lpUrl"),offer.affiliateUrl);
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer sample-test-token");
    return new Response(JSON.stringify({
      allowed:true,reasons:[],programId:offer.programId,siteId:offer.a8PlacementSiteId,
      channel:"sns",
    }),{status:200});
  };
  assert.equal((await checkCanonicalPlacement(offer)).allowed,true);

  // Users may save the existing Free Consult admin token under its original
  // name in Vercel. Accept it without changing the admin-owned DB policies.
  delete process.env.AFFILIATE_POLICY_READ_TOKEN;
  process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN="existing-free-consult-token";
  globalThis.fetch=async(_input,options)=>{
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer existing-free-consult-token");
    return new Response(JSON.stringify({allowed:false,reasons:["site_conditions_needs_review"],
      programId:offer.programId,siteId:offer.a8PlacementSiteId,channel:"sns"}),{status:200});
  };
  assert.deepEqual((await checkCanonicalPlacement(offer)).reasons,["site_conditions_needs_review"]);

  // A dedicated reader token takes precedence when present.
  process.env.AFFILIATE_POLICY_READ_TOKEN="dedicated-reader-token";
  globalThis.fetch=async(_input,options)=>{
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer dedicated-reader-token");
    return new Response(JSON.stringify({allowed:true,reasons:[],programId:offer.programId,
      siteId:offer.a8PlacementSiteId,channel:"sns"}),{status:200});
  };
  assert.equal((await checkCanonicalPlacement(offer)).allowed,true);

  globalThis.fetch=async()=>new Response(JSON.stringify({allowed:true,reasons:[],
    programId:offer.programId,siteId:"020",channel:"sns"}),{status:200});
  assert.deepEqual((await checkCanonicalPlacement(offer)).reasons,["canonical_policy_identity_mismatch"]);
  globalThis.fetch=async()=>new Response(JSON.stringify({error:"unavailable"}),{status:503});
  assert.deepEqual((await checkCanonicalPlacement(offer)).reasons,["canonical_policy_http_503"]);
  console.log("Canonical affiliate placement boundary tests passed.");
}
run().finally(()=>{
  globalThis.fetch=previousFetch;
  if(previousUrl===undefined)delete process.env.AFFILIATE_POLICY_API_URL;
  else process.env.AFFILIATE_POLICY_API_URL=previousUrl;
  if(previousToken===undefined)delete process.env.AFFILIATE_POLICY_READ_TOKEN;
  else process.env.AFFILIATE_POLICY_READ_TOKEN=previousToken;
  if(previousAdminToken===undefined)delete process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
  else process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN=previousAdminToken;
}).catch(e=>{console.error(e);process.exitCode=1;});
