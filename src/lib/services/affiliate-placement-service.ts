import type { AffiliateOfferRecord } from "@/lib/affiliate-distribution-policy";

export type PlacementDecision = {
  allowed: boolean;
  reasons: string[];
};

export const isA8Offer = (offer: Pick<AffiliateOfferRecord, "network">): boolean =>
  /^a8(?:\.net)?$/i.test(offer.network.trim());

/** Fail closed for A8 campaigns. Never infer placement permission from affiliateUrl. */
export async function checkCanonicalPlacement(
  offer: AffiliateOfferRecord,
): Promise<PlacementDecision> {
  if (!isA8Offer(offer)) return { allowed: true, reasons: [] };

  const siteId = typeof offer.a8PlacementSiteId === "string"
    ? offer.a8PlacementSiteId.trim() : "";
  const programId = offer.programId?.trim() ?? "";
  if (!/^s[0-9]{8,20}$/.test(programId) || !/^[0-9]{3}$/.test(siteId)) {
    return { allowed: false, reasons: ["canonical_placement_identity_missing"] };
  }
  const endpoint = process.env.AFFILIATE_POLICY_API_URL;
  // Support the existing Free Consult owner token without introducing another secret.
  // A dedicated read-only token takes precedence when configured.
  const token = process.env.AFFILIATE_POLICY_READ_TOKEN || process.env.AFFILIATE_INTELLIGENCE_ADMIN_TOKEN;
  if (!endpoint || !token) {
    return { allowed: false, reasons: ["canonical_policy_connection_missing"] };
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.hostname !== "consult.antonbase.com"
      || url.pathname !== "/api/placement-eligibility") {
      return { allowed: false, reasons: ["canonical_policy_endpoint_invalid"] };
    }
    url.search = new URLSearchParams({
      programId, siteId, channel: "sns", lpUrl: offer.affiliateUrl?.trim() ?? "",
    }).toString();
    const response = await fetch(url.toString(), {
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const reasons=["canonical_policy_http_" + response.status];
      if (response.status===503) {
        const diagnostics=await response.json().catch(()=>null);
        if (diagnostics && typeof diagnostics==="object") {
          const code=(diagnostics as Record<string,unknown>).backendCode;
          // Only propagate predefined status classifications, never raw backend messages.
          if (typeof code==="string" &&
            /^(?:firestore_http_(?:401|403|404|408|429|500|502|503|504)|config_missing|backend_unavailable)$/.test(code))
            reasons.push("canonical_policy_backend_"+code);
        }
      }
      return {allowed:false,reasons};
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object") {
      return { allowed: false, reasons: ["canonical_policy_invalid"] };
    }
    const r = result as Record<string, unknown>;
    if (r.programId !== programId || r.siteId !== siteId || r.channel !== "sns"
      || !Array.isArray(r.reasons) || r.reasons.some(x=>typeof x !== "string")) {
      return { allowed: false, reasons: ["canonical_policy_identity_mismatch"] };
    }
    return r.allowed === true && r.reasons.length === 0
      ? { allowed: true, reasons: [] }
      : { allowed: false, reasons: r.reasons.length ? r.reasons as string[] : ["canonical_policy_not_verified"] };
  } catch {
    return { allowed: false, reasons: ["canonical_policy_unavailable"] };
  }
}
