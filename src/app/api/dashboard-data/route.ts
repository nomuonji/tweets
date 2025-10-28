import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { fetchRecentPosts, fetchTopPosts } from "@/lib/services/firestore.server";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json(
        { ok: false, message: "Account ID is required." },
        { status: 400 },
      );
    }

    const [recentPosts, bestPostList, postCountSnap] = await Promise.all([
      fetchRecentPosts(accountId, 5),
      fetchTopPosts(accountId, 1),
      adminDb.collection("posts").where("account_id", "==", accountId).count().get(),
    ]);

    const accountData = {
      stats: {
        postCount: postCountSnap.data().count,
        bestPost: bestPostList[0] || null,
      },
      recentPosts,
    };

    // Also fetch drafts for the dashboard
    const draftsSnap = await adminDb.collection("drafts").where("target_account_id", "==", accountId).orderBy("updated_at", "desc").limit(20).get();
    const drafts = draftsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ ok: true, accountData, drafts });

  } catch (error) {
    console.error(`Failed to fetch dashboard data:`, error);
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
