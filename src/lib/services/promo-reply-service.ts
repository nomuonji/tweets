import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { generateSuggestion, GenerationUnavailableError } from "@/lib/ai/generation-client";
import { requestGrok } from "@/lib/grok/client";
import { publishXReply } from "@/lib/platforms/x";
import { publishThreadsReply } from "@/lib/platforms/threads";
import { getEligibleProducts, markProductUsed, pickPromoProduct } from "./product-service";
import {
  isSuccessfulReply,
  summarizePostAttemptHistory,
  type PostAttemptState,
} from "./promo-reply-policy";
import type { AccountDoc, PostDoc, PromoReplyDoc, ProductDoc } from "@/lib/types";

const DEFAULT_MIN_SCORE = 1000;
const DEFAULT_MIN_IMPRESSIONS = 1000;
const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_COOLDOWN_MINUTES = 60;
const DEFAULT_FAILURE_RETRY_MINUTES = 180;
const MAX_FAILURES_PER_POST = 3;
const MAX_GENERATION_ATTEMPTS = 3;

export type PromoReplyAttemptResult = {
  outcome: "posted" | "skipped" | "failed";
  attempted: boolean;
  haltAccount: boolean;
  reply?: PromoReplyDoc;
  reason?: string;
};

function replyCollection(accountId: string) {
  return adminDb.collection("accounts").doc(accountId).collection("promo_replies");
}

/** How recently the account last posted a promo reply (for cooldown). */
export async function getLastSuccessfulPromoReplyTime(
  account: AccountDoc,
): Promise<DateTime | null> {
  const accountLastReply = account.lastPromoReplyAt;
  if (typeof accountLastReply === "string") {
    const parsed = DateTime.fromISO(accountLastReply);
    if (parsed.isValid) return parsed;
  }

  // Backward-compatible fallback for accounts created before lastPromoReplyAt.
  const snapshot = await replyCollection(account.id)
    .orderBy("created_at", "desc")
    .limit(50)
    .get();
  const latestSuccess = snapshot.docs
    .map((doc) => doc.data() as PromoReplyDoc)
    .find(isSuccessfulReply);
  if (!latestSuccess) return null;
  const created = DateTime.fromISO(latestSuccess.created_at);
  if (created.isValid) {
    // Backfill the account-level marker once so future syncs avoid scanning
    // reply history for cooldown checks.
    await adminDb.collection("accounts").doc(account.id).set({
      lastPromoReplyAt: latestSuccess.created_at,
    }, { merge: true }).catch(() => {});
  }
  return created.isValid ? created : null;
}

async function getPostAttemptState(
  accountId: string,
  postId: string,
): Promise<PostAttemptState> {
  const snapshot = await replyCollection(accountId)
    .where("post_id", "==", postId)
    .get();
  const replies = snapshot.docs.map((doc) => doc.data() as PromoReplyDoc);
  return summarizePostAttemptHistory(replies);
}

export function isPromoReplyEligible(
  account: AccountDoc,
  post: PostDoc,
  now: DateTime,
): boolean {
  if (account.promoReplyEnabled !== true) return false;

  const minScore = account.promoReplyMinScore ?? DEFAULT_MIN_SCORE;
  const minImpressions = account.promoReplyMinImpressions ?? DEFAULT_MIN_IMPRESSIONS;
  const lookbackDays = account.promoReplyLookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  if (post.promo_replied_at) return false;
  if (post.metrics.impressions == null) return false;
  if (post.metrics.impressions < minImpressions) return false;
  if (post.score < minScore) return false;

  const created = DateTime.fromISO(post.created_at);
  if (!created.isValid) return false;
  if (now.diff(created, "days").days > lookbackDays) return false;

  return true;
}

function buildReplyPrompt(post: PostDoc, product: ProductDoc): string {
  const productUrl =
    product.url ?? `https://www.amazon.co.jp/dp/${product.asin}/`;
  const lines = [
    `You write a reply to the account's own high-performing post on ${post.platform.toUpperCase()}.`,
    ``,
    `# ORIGINAL POST (which performed well)`,
    post.text.slice(0, 500),
    ``,
    `# GOAL`,
    `Write a natural reply to the above post that also introduces the product below as a helpful follow-up. It should feel like continuing the conversation, not an ad. Keep it short and in the account's voice.`,
    ``,
    `# PRODUCT`,
    `- 商品名: ${product.title}`,
    product.price ? `- 価格: ${product.price}` : "",
    product.category ? `- カテゴリ: ${product.category}` : "",
    product.description ? `- ターゲット層に刺さる理由: ${product.description}` : "",
    product.promo_hook ? `- おすすめの切り口: ${product.promo_hook}` : "",
    `- 掲載するURL: ${productUrl}`,
    ``,
    `# RULES`,
    `- The URL MUST be included in the reply text.`,
    `- Reply directly relates to the original post's topic.`,
    `- Natural, conversational, not salesy.`,
    `- Do not fabricate facts about the product.`,
    `- Target length: 80-180 characters (max 240).`,
  ].filter(Boolean);

  return `${lines.join("\n")}

Output strictly in JSON:
{
  "tweet": "Content...",
  "explanation": "Reasoning..."
}`;
}

async function generateReplyText(
  account: AccountDoc,
  post: PostDoc,
  product: ProductDoc,
): Promise<string> {
  const prompt = buildReplyPrompt(post, product);

  if (account.r18Mode) {
    const xaiApiKey = process.env.XAI_API_KEY;
    if (!xaiApiKey) {
      throw new Error("XAI_API_KEY environment variable is not configured.");
    }
    const suggestion = await requestGrok(prompt, xaiApiKey);
    const text = suggestion.tweet.trim();
    if (!text.includes("http")) {
      throw new Error("Generated reply does not contain a URL; skipping to avoid a product post without a link.");
    }
    return text;
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const suggestion = (await generateSuggestion(prompt)).value;
      const text = suggestion.tweet.trim();
      if (!text.includes("http")) {
        throw new Error("Generated reply does not contain a URL.");
      }
      return text;
    } catch (error) {
      // Treat an outage across both providers as a run-level event and preserve
      // this post for the next sync.
      if (error instanceof GenerationUnavailableError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_GENERATION_ATTEMPTS) {
        console.warn(
          `[PromoReply] Invalid Gemini generation (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS}). Retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw new Error(
    `Text generation remained invalid after ${MAX_GENERATION_ATTEMPTS} attempts: ${lastError?.message ?? "Unknown error"}`,
  );
}

async function publishReply(account: AccountDoc, text: string, post: PostDoc) {
  if (post.platform === "x") {
    return publishXReply(account, { text, replyToId: post.platform_post_id });
  }
  return publishThreadsReply(account, { text, replyToId: post.platform_post_id });
}

/**
 * Attempt to auto-post a product-promotion reply under `post` if it qualifies.
 * Returns the created reply doc, or null if the post was not eligible / no
 * product was available. Post-specific failures are recorded; provider outages
 * halt this account for the current sync without changing post eligibility.
 */
export async function maybePromoReply(
  account: AccountDoc,
  post: PostDoc,
  now: DateTime = DateTime.utc(),
  options: {
    ignoreCooldown?: boolean;
    lastSuccessfulReplyAt?: DateTime | null;
  } = {},
): Promise<PromoReplyAttemptResult> {
  let product: ProductDoc | null = null;
  let generatedText = "";
  try {
    if (!isPromoReplyEligible(account, post, now)) {
      return { outcome: "skipped", attempted: false, haltAccount: false };
    }

    const lastReplyPromise = "lastSuccessfulReplyAt" in options
      ? Promise.resolve(options.lastSuccessfulReplyAt ?? null)
      : getLastSuccessfulPromoReplyTime(account);
    const [postState, lastReply] = await Promise.all([
      getPostAttemptState(account.id, post.id),
      lastReplyPromise,
    ]);
    if (postState.alreadyPosted) {
      return { outcome: "skipped", attempted: false, haltAccount: false };
    }
    if (postState.failureCount >= MAX_FAILURES_PER_POST) {
      return {
        outcome: "skipped",
        attempted: false,
        haltAccount: false,
        reason: "max_failures_reached",
      };
    }
    if (postState.retryAfter && postState.retryAfter.toMillis() > now.toMillis()) {
      return {
        outcome: "skipped",
        attempted: false,
        haltAccount: false,
        reason: "failure_backoff",
      };
    }

    const cooldownMinutes =
      account.promoReplyCooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
    if (!options.ignoreCooldown && lastReply && now.diff(lastReply, "minutes").minutes < cooldownMinutes) {
      return { outcome: "skipped", attempted: false, haltAccount: false, reason: "cooldown" };
    }

    product = await pickPromoProduct(account.id);
    if (!product) {
      return { outcome: "skipped", attempted: false, haltAccount: false, reason: "no_product" };
    }

    generatedText = await generateReplyText(account, post, product);
    const result = await publishReply(account, generatedText, post);

    const replyId = `promo_reply_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const reply: PromoReplyDoc = {
      id: replyId,
      account_id: account.id,
      platform: post.platform,
      post_id: post.id,
      platform_post_id: result.platform_post_id,
      product_id: product.id,
      product_asin: product.asin,
      text: generatedText,
      status: "posted",
      created_at: now.toISO() ?? DateTime.utc().toISO()!,
      updated_at: now.toISO() ?? DateTime.utc().toISO()!,
    };

    const batch = adminDb.batch();
    batch.set(replyCollection(account.id).doc(replyId), reply);
    batch.update(adminDb.collection("posts").doc(post.id), {
      promo_replied_at: reply.created_at,
    });
    batch.set(adminDb.collection("accounts").doc(account.id), {
      lastPromoReplyAt: reply.created_at,
      updated_at: reply.updated_at,
    }, { merge: true });
    await batch.commit();
    await markProductUsed(account.id, product.id);

    console.log(
      `[PromoReply] Posted reply ${result.platform_post_id} under post ${post.id} for account ${account.id} promoting ${product.asin}.`,
    );
    return {
      outcome: "posted",
      attempted: true,
      haltAccount: false,
      reply,
    };
  } catch (error) {
    console.error(`[PromoReply] Failed for post ${post.id} account ${account.id}:`, error);
    const err = error as Error;
    const providerUnavailable = error instanceof GenerationUnavailableError;
    if (providerUnavailable) {
      // Do not attach transient provider state to the post. The account is
      // halted for this sync and the same post remains eligible next time.
      return {
        outcome: "failed",
        attempted: true,
        haltAccount: true,
        reason: "provider_unavailable",
      };
    }
    const failureKind: PromoReplyDoc["failure_kind"] = generatedText
      ? "publish"
      : "generation";
    const retryAfter = now
      .plus({ minutes: DEFAULT_FAILURE_RETRY_MINUTES })
      .toISO() ?? DateTime.utc().plus({ minutes: DEFAULT_FAILURE_RETRY_MINUTES }).toISO()!;
    const replyId = `promo_reply_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const failed: PromoReplyDoc = {
      id: replyId,
      account_id: account.id,
      platform: post.platform,
      post_id: post.id,
      platform_post_id: "",
      product_id: product?.id ?? "",
      product_asin: product?.asin ?? "",
      text: generatedText,
      status: "failed",
      failure_kind: failureKind,
      retry_after_at: retryAfter,
      created_at: DateTime.utc().toISO(),
      updated_at: DateTime.utc().toISO(),
      error: err.message,
    };
    // Keep failure history for bounded retries and monitoring. Failed records
    // never count as a successful reply or start the normal success cooldown.
    await replyCollection(account.id).doc(replyId).set(failed).catch(() => {});
    return {
      outcome: "failed",
      attempted: true,
      haltAccount: providerUnavailable,
      reply: failed,
      reason: failureKind,
    };
  }
}

/** Export helpers for tests/tooling. */
export async function listPromoReplies(accountId: string): Promise<PromoReplyDoc[]> {
  const snapshot = await replyCollection(accountId).orderBy("created_at", "desc").get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PromoReplyDoc);
}

export async function getEligibleCount(accountId: string): Promise<number> {
  const products = await getEligibleProducts(accountId);
  return products.length;
}
