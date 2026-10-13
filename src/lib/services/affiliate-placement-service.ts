import type { AffiliateOfferRecord } from "@/lib/affiliate-distribution-policy";

export type PlacementDecision = {
  allowed: boolean;
  reasons: string[];
  warnings?: string[];
};

// The owner has opted for an LP-first, limited live experiment. These two
// campaign/LP pairs have *observed* CTA mismatches with the canonical catalog.
// Keep them blocked until the tracking-media discrepancy is reconciled.
const UNRESOLVED_CTA_MISMATCHES = new Set([
  "BA0Wz65EVGpOXBOk7AHZ", // Veruni normal / Bloom
  "BFTZwJaQ07PGzGycS1bg", // Coconala phone / Bloom
]);
const PROHIBITION_REASONS = new Set([
  "partnership_not_approved", "website_not_permitted", "sns_not_permitted",
  "lp_not_permitted", "site_link_not_issued", "cta_program_mismatch",
  "cta_site_mismatch", "lp_url_mismatch", "lp_url_required", "invalid_channel",
  "site_id_required", "program_not_found",
]);

export const isA8Offer = (offer: Pick<AffiliateOfferRecord, "network">): boolean =>
  /^a8(?:\\.net)?$/i.test(offer.network.trim());

function ownedLandingUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" ||
      !["bloom.antonbase.com", "yohaku.antonbase.com"].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      !url.pathname.endsWith("/") || url.pathname === "/") return null;
    return url;
  } catch {
    return null;
  }
}

export async function checkPublicLpReady(lpUrl: string): Promise<PlacementDecision> {
  const url = ownedLandingUrl(lpUrl);
  if (!url) return {allowed:false,reasons:["lp_url_invalid"]};
  try {
    const response = await fetch(url.toString(), {
      headers: {accept:"text/html", "user-agent":"AntonbaseAffiliateLPCheck/1.0"},
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(9000),
    });
    if (!response.ok || response.status !== 200 || response.url !== url.toString() ||
      !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      return {allowed:false,reasons:["lp_not_public_200"]};
    }
    const html = await response.text();
    if (html.length > 800000) return {allowed:false,reasons:["lp_response_too_large"]};
    const withoutScripts = html
      .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, "")
      .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, "")
      .replace(/<!--[\\s\\S]*?-->/g,"");
    const visible = withoutScripts.replace(/<[^>]*>/g," ").replace(/\\s+/g," ");
    if (!/(?:^|[^a-z])PR(?:[^a-z]|$)|アフィリエイト広告|広告を含|プロモーションを含/i.test(visible)) {
      return {allowed:false,reasons:["lp_disclosure_missing"]};
    }
    if (!/<a\\b[^>]*\\bhref\\s*=\\s*["']https:\\/\\/px\\.a8\\.net\\/[^"']+["'][^>]*>/i.test(withoutScripts)) {
      return {allowed:false,reasons:["lp_affiliate_cta_missing"]};
    }
    return {allowed:true,reasons:[]};
  } catch {
    return {allowed:false,reasons:["lp_fetch_unavailable"]};
  }
}

// A fresh live check on every preflight is intentional: a paused or deleted
// LP must never remain approved by a stale success cache.
async function canonicalPolicyAdvice(offer: AffiliateOfferRecord): Promise<PlacementDecision> {
  const endpoint = process.env.AFFILIATE_POLICY_API_URL;
  const token = process.env.AFFILIATE_POLICY_READ_TOKEN ||
    process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
  if (!endpoint || !token) return {allowed:true,reasons:[],warnings:["canonical_policy_unavailable"]};
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.hostname !== "consult.antonbase.com" ||
      url.pathname !== "/api/placement-eligibility" || url.search || url.hash) {
      return {allowed:false,reasons:["canonical_policy_endpoint_invalid"]};
    }
    url.search = new URLSearchParams({
      programId:offer.programId!.trim(), siteId:offer.a8PlacementSiteId!.trim(),
      channel:"sns", lpUrl:offer.affiliateUrl!.trim(),
    }).toString();
    const response = await fetch(url.toString(), {
      headers:{authorization:"Bearer "+token,accept:"application/json"},
      cache:"no-store",signal:AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return {allowed:true,reasons:[],warnings:["canonical_policy_http_"+response.status]};
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") return {allowed:true,reasons:[],warnings:["canonical_policy_unavailable"]};
    const p=data as Record<string,unknown>;
    if (p.programId !== offer.programId || p.siteId !== offer.a8PlacementSiteId ||
      p.channel !== "sns" || !Array.isArray(p.reasons) ||
      p.reasons.some(x=>typeof x!=="string")) {
      return {allowed:false,reasons:["canonical_policy_identity_mismatch"]};
    }
    const blockers = (p.reasons as string[]).filter(reason=>PROHIBITION_REASONS.has(reason));
    return {allowed:blockers.length===0,reasons:blockers,
      warnings:(p.reasons as string[]).filter(reason=>!PROHIBITION_REASONS.has(reason))};
  } catch {
    return {allowed:true,reasons:[],warnings:["canonical_policy_unavailable"]};
  }
}

/**
 * LP-first pilot. Do not claim advertiser approval from missing records.
 * Stop on a known ban, invalid A8 identity, mismatched CTA, unavailable LP,
 * missing ad disclosure, or missing ad CTA. Unknown review status and
 * temporary canonical DB failures are recorded as warnings, not blockers.
 */
export async function checkCanonicalPlacement(offer: AffiliateOfferRecord): Promise<PlacementDecision> {
  if (!isA8Offer(offer)) return {allowed:true,reasons:[]};
  const siteId=offer.a8PlacementSiteId?.trim()??"";
  const programId=offer.programId?.trim()??"";
  if (!/^s[0-9]{8,20}$/.test(programId) || !/^[0-9]{3}$/.test(siteId)) {
    return {allowed:false,reasons:["canonical_placement_identity_missing"]};
  }
  if (UNRESOLVED_CTA_MISMATCHES.has(offer.id)) {
    return {allowed:false,reasons:["lp_cta_mismatch_known"]};
  }
  const lp=await checkPublicLpReady(offer.affiliateUrl?.trim()??"");
  if (!lp.allowed) return lp;
  const advice=await canonicalPolicyAdvice(offer);
  return {allowed:advice.reasons.length===0,reasons:advice.reasons,
    warnings:advice.warnings};
}
