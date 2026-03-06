import { getAccounts, getDraftsByAccountId, fetchTopPosts, fetchRecentPosts, getAllTips } from "@/lib/services/firestore.server";
import { adminDb } from "@/lib/firebase/admin";
import 'dotenv/config';

// 過去のお手本投稿(ExemplaryPost)を取得する補助関数
async function fetchExemplaryPosts(accountId: string) {
    const snapshot = await adminDb.collection("accounts").doc(accountId).collection("exemplary_posts").orderBy("created_at", "desc").limit(5).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function main() {
    console.warn("Fetching accounts and draft counts...");
    const accounts = await getAccounts();
    const needsDrafts = [];

    // Tips（投稿のコツ等）を全体から用意しておく
    const allTips = await getAllTips();

    for (const acc of accounts) {
        const drafts = await getDraftsByAccountId(acc.id);
        if (drafts.length < 5) {
            console.warn(`[${acc.handle}] has ${drafts.length} drafts.`);

            const [topPosts, recentPosts, exemplaryPosts] = await Promise.all([
                fetchTopPosts(acc.id, 5),
                fetchRecentPosts(acc.id, 5),
                fetchExemplaryPosts(acc.id)
            ]);

            needsDrafts.push({
                accountId: acc.id,
                handle: acc.handle,
                concept: acc.concept,
                platform: acc.platform,
                neededCount: 5 - drafts.length,
                payload: {
                    topPosts: topPosts.map((p: any) => p.text),
                    recentPosts: recentPosts.map((p: any) => p.text),
                    drafts: drafts.map((d: any) => d.text),
                    exemplaryPosts: exemplaryPosts.map((p: any) => p.text),
                    tips: allTips.slice(0, 5).map((t: any) => t.content)
                }
            });
        }
    }

    // Agentに読ませるために標準出力へ
    console.log(JSON.stringify(needsDrafts, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
