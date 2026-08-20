import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { requestGemini } from "@/lib/gemini/client";
import { requestGrok } from "@/lib/grok/client";
import { parseGeminiResponse } from "@/lib/gemini/parser";
import { publishXReply } from "@/lib/platforms/x";
import { publishThreadsReply } from "@/lib/platforms/threads";
import { getEligibleProducts, markProductUsed, pickPromoProduct } from "./product-service";
import type { AccountDoc, PostDoc, PromoReplyDoc, ProductDoc } from "@/lib/types";

const DEFAULT_MIN_SCORE = 1000;
const DEFAULT_MIN_IMPRESSIONS = 1000;
const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_COOLDOWN_MINUTES = 60;

function replyCollection(accountId: string) {
  return adminDb.collection("accounts").doc(accountId).collection("promo_replies");
}

/** How recently the account last posted a promo reply (for cooldown). */
async function lastReplyTime(accountId: string): Promise<DateTime | null> {
  const snapshot = await replyCollection(accountId)
    .orderBy("created_at", "desc")
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const created = DateTime.fromISO((snapshot.docs[0].data() as PromoReplyDoc).created_at);
  return created.isValid ? created : null;
}

/** True if this post already has a promo reply recorded. */
async function hasPromoReply(accountId: string, postId: string): Promise<boolean> {
  const snapshot = await replyCollection(accountId)
    .where("post_id", "==", postId)
    .limit(1)
    .get();
  return !snapshot.empty;
}

function isEligible(account: AccountDoc, post: PostDoc, now: DateTime): boolean {
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

  let suggestion: { tweet: string };
  if (account.r18Mode) {
    const xaiApiKey = process.env.XAI_API_KEY;
    if (!xaiApiKey) {
      throw new Error("XAI_API_KEY environment variable is not configured.");
    }
    suggestion = await requestGrok(prompt, xaiApiKey);
  } else {
    const raw = await requestGemini(prompt);
    suggestion = parseGeminiResponse(raw);
  }

  const text = suggestion.tweet.trim();
  if (!text.includes("http")) {
    throw new Error("Generated reply does not contain a URL; skipping to avoid a product post without a link.");
  }
  return text;
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
 * product was available. Any failure is recorded on the reply doc but does not
 * throw, so sync continues for the rest of the account.
 */
export async function maybePromoReply(
  account: AccountDoc,
  post: PostDoc,
  now: DateTime = DateTime.utc(),
): Promise<PromoReplyDoc | null> {
  try {
    if (!isEligible(account, post, now)) return null;

    const [already, lastReply] = await Promise.all([
      hasPromoReply(account.id, post.id),
      lastReplyTime(account.id),
    ]);
    if (already) return null;

    const cooldownMinutes =
      account.promoReplyCooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
    if (lastReply && now.diff(lastReply, "minutes").minutes < cooldownMinutes) {
      return null;
    }

    const product = await pickPromoProduct(account.id);
    if (!product) return null;

    const text = await generateReplyText(account, post, product);
    const result = await publishReply(account, text, post);

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
      text,
      created_at: now.toISO() ?? DateTime.utc().toISO()!,
      updated_at: now.toISO() ?? DateTime.utc().toISO()!,
    };

    const batch = adminDb.batch();
    batch.set(replyCollection(account.id).doc(replyId), reply);
    batch.update(adminDb.collection("posts").doc(post.id), {
      promo_replied_at: reply.created_at,
    });
    await batch.commit();
    await markProductUsed(account.id, product.id);

    console.log(
      `[PromoReply] Posted reply ${result.platform_post_id} under post ${post.id} for account ${account.id} promoting ${product.asin}.`,
    );
    return reply;
  } catch (error) {
    console.error(`[PromoReply] Failed for post ${post.id} account ${account.id}:`, error);
    const err = error as Error;
    const replyId = `promo_reply_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const failed: PromoReplyDoc = {
      id: replyId,
      account_id: account.id,
      platform: post.platform,
      post_id: post.id,
      platform_post_id: "",
      product_id: "",
      product_asin: "",
      text: "",
      created_at: DateTime.utc().toISO(),
      updated_at: DateTime.utc().toISO(),
      error: err.message,
    };
    // Record the failure so we do not keep retrying the same post every sync.
    await replyCollection(account.id).doc(replyId).set(failed).catch(() => {});
    return null;
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
