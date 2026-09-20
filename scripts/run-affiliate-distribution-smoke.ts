import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTweetsMcpServer } from "@/lib/mcp/server";
import {
  getAffiliateOffer,
  saveAffiliateOffer,
} from "@/lib/services/affiliate-offer-service";

const OFFER_ID = "smoke_uzuz_second_newgrad_candidate_v1";

async function main() {
  const existing = await getAffiliateOffer(OFFER_ID);
  const offer = existing ?? await saveAffiliateOffer({
    id: OFFER_ID,
    offer: {
      kind: "lead",
      network: "a8",
      advertiser: "UZUZ",
      title: "UZUZ第二新卒（テスト候補・ASP承認/URL確認前）",
      description: "Affiliate Distribution v1 smoke-test candidate. Not approved for publishing.",
      category: "career",
      themes: ["career", "work", "job_change", "twenties"],
      conversionAction: "registration_or_consultation",
      status: "candidate",
      allowedPlatforms: ["threads"],
      allowedAccountIds: ["threads_plansetting", "threads_date_blueprints"],
      personaFits: ["devil_dog_ch", "date_blueprints"],
      promoHooks: ["20代の転職条件・働き方の文脈から自然に案内する"],
      prohibitedClaims: ["内定保証", "年収アップ保証", "必ず転職できる"],
      disclosureText: "PR",
      notes: "Smoke-test candidate only. Keep candidate until ASP approval and the real affiliate URL are verified.",
      sourceUrl: "",
    },
  });

  assert.equal(offer.id, OFFER_ID);
  assert.equal(offer.status, "candidate");
  assert.equal(offer.affiliateUrl, undefined);

  const server = createTweetsMcpServer();
  const client = new Client({ name: "affiliate-distribution-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const listed = await client.listTools();
  assert.ok(listed.tools.some((tool) => tool.name === "get_affiliate_reply_work"));
  assert.ok(listed.tools.some((tool) => tool.name === "save_affiliate_offer"));

  const response = await client.callTool({
    name: "get_affiliate_reply_work",
    arguments: {
      accountId: "threads_date_blueprints",
      postLimit: 20,
      offerLimit: 100,
    },
  });
  const textContent = response.content.find(
    (part): part is { type: "text"; text: string } => part.type === "text",
  );
  assert.ok(textContent?.text);
  const work = JSON.parse(textContent.text) as {
    candidatePosts: Array<Record<string, unknown>>;
    offerCatalog: { candidate: number; total: number; active: number; pendingApproval: number };
  };

  assert.ok(Array.isArray(work.candidatePosts));
  assert.ok(work.offerCatalog.candidate >= 1);

  const mentionsOffer = work.candidatePosts.some((entry) => {
    const blocked = Array.isArray(entry.blockedOffers)
      ? entry.blockedOffers as Array<Record<string, unknown>>
      : [];
    return blocked.some((item) => {
      const nested = item.offer as Record<string, unknown> | undefined;
      return nested?.id === OFFER_ID;
    });
  });

  console.log(JSON.stringify({
    mcp: {
      toolCount: listed.tools.length,
      getAffiliateReplyWorkRegistered: true,
      saveAffiliateOfferRegistered: true,
    },
    offer: {
      id: offer.id,
      status: offer.status,
      title: offer.title,
      affiliateUrl: offer.affiliateUrl ?? null,
      allowedAccountIds: offer.allowedAccountIds ?? [],
    },
    replyWork: {
      candidatePostCount: work.candidatePosts.length,
      catalog: work.offerCatalog,
      smokeOfferReturnedInBlockedMatches: mentionsOffer,
      firstCandidate: work.candidatePosts[0] ?? null,
    },
  }, null, 2));

  await client.close();
  await server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
