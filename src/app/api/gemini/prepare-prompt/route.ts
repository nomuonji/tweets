import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import type { AccountDoc, DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";
import { DateTime } from "luxon";

// NOTE: This file reuses a lot of logic from generate/route.ts.
// In a real application, this shared logic should be refactored into a common service.

// --- Data Fetching Functions (copied from generate/route.ts) ---
async function fetchAccount(accountId: string): Promise<AccountDoc | null> {
    const doc = await adminDb.collection("accounts").doc(accountId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as AccountDoc;
}

async function fetchSelectedTips(tipIds: string[]): Promise<Tip[]> {
    if (tipIds.length === 0) return [];
    const snapshot = await adminDb.collection("tips").where("__name__", "in", tipIds).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Tip[];
}

async function fetchExemplaryPosts(accountId: string): Promise<ExemplaryPost[]> {
    const snapshot = await adminDb.collection("accounts").doc(accountId).collection("exemplary_posts").orderBy("created_at", "desc").limit(10).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ExemplaryPost[];
}

async function fetchTopPosts(accountId: string, limit: number): Promise<PostDoc[]> {
    const snapshot = await adminDb.collection("posts").where("account_id", "==", accountId).orderBy("score", "desc").limit(limit).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as PostDoc[];
}

async function fetchRecentPosts(accountId: string, limit: number): Promise<PostDoc[]> {
    const snapshot = await adminDb.collection("posts").where("account_id", "==", accountId).orderBy("created_at", "desc").limit(limit).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as PostDoc[];
}

async function fetchExistingDrafts(accountId: string, limit: number): Promise<DraftDoc[]> {
    const snapshot = await adminDb.collection("drafts").where("target_account_id", "==", accountId).orderBy("updated_at", "desc").limit(limit).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as DraftDoc[];
}

function dedupePostSets(topPosts: PostDoc[], recentPosts: PostDoc[]) {
  const seen = new Set<string>();
  const uniqueTop = topPosts.filter(post => { const key = post.id ?? `${post.platform}_${post.platform_post_id}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const uniqueRecent = recentPosts.filter(post => { const key = post.id ?? `${post.platform}_${post.platform_post_id}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return { uniqueTop, uniqueRecent };
}

// --- Prompt Building Functions (copied from generate/route.ts) ---
function formatPostSummary(posts: PostDoc[]) {
  return posts.map((post, index) => {
    const created = DateTime.fromISO(post.created_at).toFormat("yyyy-LL-dd");
    const impressions = post.metrics.impressions ?? 0;
    return [
      `${index + 1}. ${created} @${post.account_id}`,
      `   Text: ${post.text}`,
      `   Metrics: impressions=${impressions}, likes=${post.metrics.likes}, reposts=${post.metrics.reposts_or_rethreads}, replies=${post.metrics.replies}, score=${post.score.toFixed(3)}`,
    ].join("\n");
  });
}

function buildPrompt(
  topPosts: PostDoc[],
  recentPosts: PostDoc[],
  drafts: DraftDoc[],
  tips: Tip[],
  exemplaryPosts: ExemplaryPost[]
) {
  const topSummary = topPosts.length
    ? `Top performing posts ranked by engagement:\n${formatPostSummary(topPosts).join("\n")}`
    : "Top performing posts ranked by engagement:\n- No historical high performers available.";

  const recentSummary = recentPosts.length
    ? `Latest posts (newest first):\n${formatPostSummary(recentPosts).join("\n")}`
    : "Latest posts (newest first):\n- No recent posts available.";

  const tipsBlock = tips.length > 0
    ? `\nGeneral guidance and tips for writing effective posts:\n${tips.map(tip => `- ${tip.text}`).join("\n")}\n`
    : "";

  const exemplaryBlock = exemplaryPosts.length > 0
    ? `\nStudy these exemplary posts for style and tone:\n${exemplaryPosts.map(p => `Post: ${p.text}\nReasoning: ${p.explanation}`).join("\n\n")}\n`
    : "";

  const avoidList = Array.from(
    new Set(
      [...drafts.map((draft) => draft.text)]
        .filter(Boolean)
        .map((text) => text.trim()),
    ),
  )
    .slice(0, 20)
    .map((text) => `- ${text.replace(/\s+/g, " ").slice(0, 120)}`);

  const avoidBlock = 
    avoidList.length > 0
      ? `\nAvoid repeating these existing drafts or suggesting something semantically identical:\n${avoidList.join(
          "\n",
        )}\n`
      : "";

  return `
You are an experienced social media strategist for short form posts on X (Twitter).

You will receive several datasets to inform your writing. Use all of them to create the best possible post.
1. General Tips: These are universal principles for creating engaging content. Internalize them.
2. Exemplary Posts: These are specific examples of the desired style and tone for this account. Emulate them.
3. High-Performing Posts: These are past successes. Analyze them to understand what works for this audience.
4. Recent Posts: This is what has been posted lately. Do not repeat these topics.

Your task is to write a brand new post idea that is consistent with the brand voice and exemplary posts, incorporates the general tips, learns from the high-performing posts, and introduces a fresh angle not seen in the recent posts.

Output requirements (strict):
- Respond ONLY with a single JSON object exactly like {"tweet":"...", "explanation":"..."}.
- "tweet": the new post text (<= 260 characters, no surrounding quotes).
- "explanation": concise reasoning in Japanese (<= 200 characters) referencing observed metrics, stylistic cues, or tips.
- Keep the tone in Japanese if the prior examples are in Japanese. Preserve useful emoji or punctuation patterns.
- Do not add any additional fields, markdown, or commentary.
- Avoid repeating existing draft texts or their close variations.

Here is your data:\n${tipsBlock}\n${exemplaryBlock}\n${topSummary}\n\n${recentSummary}\n${avoidBlock}\nRespond only with JSON.`;
}


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const accountId = String(body.accountId ?? "").trim();
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : 15;

    if (!accountId) {
      return NextResponse.json({ ok: false, message: "accountId is required." }, { status: 400 });
    }

    const account = await fetchAccount(accountId);
    if (!account) {
        return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    }

    const normalizedLimit = Math.min(Math.max(limit, 6), 40);
    const perCategoryLimit = Math.min(Math.max(Math.ceil(normalizedLimit / 2), 3), 20);

    const [rawTopPosts, rawRecentPosts, drafts, tips, exemplaryPosts] = await Promise.all([
        fetchTopPosts(accountId, perCategoryLimit),
        fetchRecentPosts(accountId, perCategoryLimit),
        fetchExistingDrafts(accountId, 50),
        fetchSelectedTips(account.selectedTipIds || []),
        fetchExemplaryPosts(accountId),
    ]);

    const { uniqueTop, uniqueRecent } = dedupePostSets(rawTopPosts, rawRecentPosts);
    const referenceTop = uniqueTop.slice(0, perCategoryLimit);
    const referenceRecent = uniqueRecent.slice(0, perCategoryLimit);

    // Note: In prepare-prompt, we don't have `extraAvoid`, so the prompt might be slightly different from the final one if duplicates are found.
    const prompt = buildPrompt(referenceTop, referenceRecent, drafts, tips, exemplaryPosts);

    return NextResponse.json({ ok: true, prompt });

  } catch (error) {
    // Handle potential index errors gracefully for the user
    const message = (error as Error).message ?? "";
    if (message.includes("requires an index")) {
        return NextResponse.json(
            { ok: false, message: `Query requires a Firestore index. Please create it in the Firebase console. Details: ${message}` },
            { status: 400 },
        );
    }

    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
