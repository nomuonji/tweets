import type { PostMetrics, ProductPerformance } from "@/lib/types";

export const AFFILIATE_BASELINE_MIN_POSTS = 5;
export const AFFILIATE_BASELINE_WINDOW = 20;
export type AffiliateEvaluationResult = "strong" | "neutral" | "weak" | "insufficient_baseline" | "pending";
export interface AffiliateEvaluation { result: AffiliateEvaluationResult; baselineCount: number; weightedEngagement: number; weightedEngagementRate: number | null; medianImpressions: number | null; medianWeightedEngagementRate: number | null; impressionRatio: number | null; engagementRateRatio: number | null; }

export function weightedEngagement(metrics: PostMetrics): number {
  return (metrics.likes ?? 0) + 2*(metrics.reposts_or_rethreads ?? 0) + 2*(metrics.replies ?? 0) + 2*(metrics.quotes ?? 0) + 3*(metrics.link_clicks ?? 0);
}
export function weightedEngagementRate(metrics: PostMetrics): number | null {
  if (metrics.impressions === null || metrics.impressions === undefined || metrics.impressions <= 0) return null;
  return weightedEngagement(metrics) / Math.max(metrics.impressions, 1);
}
export function median(values: number[]): number | null {
  if (!values.length) return null; const sorted=[...values].sort((a,b)=>a-b); const m=Math.floor(sorted.length/2); return sorted.length%2===0?(sorted[m-1]+sorted[m])/2:sorted[m];
}
export function evaluateAffiliatePost72h(current: PostMetrics, baseline: PostMetrics[]): AffiliateEvaluation {
  const weighted=weightedEngagement(current); const rate=weightedEngagementRate(current);
  const eligible=baseline.filter((m)=>m.impressions!==null&&m.impressions!==undefined&&m.impressions>0).slice(-AFFILIATE_BASELINE_WINDOW);
  if (current.impressions===null||current.impressions===undefined||current.impressions<=0||rate===null) return {result:"pending",baselineCount:eligible.length,weightedEngagement:weighted,weightedEngagementRate:rate,medianImpressions:null,medianWeightedEngagementRate:null,impressionRatio:null,engagementRateRatio:null};
  const rates=eligible.map(weightedEngagementRate).filter((v):v is number=>v!==null); const medImp=median(eligible.map((m)=>m.impressions as number)); const medRate=median(rates);
  if (eligible.length<AFFILIATE_BASELINE_MIN_POSTS||medImp===null||medRate===null) return {result:"insufficient_baseline",baselineCount:eligible.length,weightedEngagement:weighted,weightedEngagementRate:rate,medianImpressions:medImp,medianWeightedEngagementRate:medRate,impressionRatio:null,engagementRateRatio:null};
  const ir=current.impressions/Math.max(medImp,1); const er=medRate>0?rate/medRate:rate>0?Number.MAX_SAFE_INTEGER:1;
  const result:AffiliateEvaluationResult=ir>=1.5||er>=1.5?"strong":ir<0.6&&er<0.8?"weak":"neutral";
  return {result,baselineCount:eligible.length,weightedEngagement:weighted,weightedEngagementRate:rate,medianImpressions:medImp,medianWeightedEngagementRate:medRate,impressionRatio:ir,engagementRateRatio:er};
}
export function shouldAutoArchiveProduct(performance?: ProductPerformance): boolean {
  if (!performance || (performance.strong_count ?? 0)>0 || performance.best_result==="strong") return false;
  const weak=new Set((performance.posts ?? []).filter((p)=>p.result==="weak"&&Boolean(p.checkpoints?.["72h"])).map((p)=>p.creative_asset_id).filter((v):v is string=>Boolean(v)));
  return weak.size>=2;
}
