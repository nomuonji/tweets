import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import type { AccountDoc, DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";
import { DateTime } from "luxon";
import { buildPrompt } from "@/lib/gemini/prompt";

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
    const prompt = buildPrompt(referenceTop, [], referenceRecent, drafts, [], tips, exemplaryPosts, account.concept);

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
