/**
 * Threads引用投稿エンゲージメントスクリプト
 * 
 * RapidAPI (Meta Threads by Glavier) で競合の投稿を取得し、
 * 公式Threads APIで引用投稿を実行します。
 * 
 * モード:
 * 1. [--collect] 収集モード: ターゲットアカウントのuserIdを取得して保存
 * 2. [通常] エンゲージメントモード: 投稿を取得してAI評価→引用投稿
 * 
 * 使用方法:
 * npx ts-node examples/engagement_script.ts           # エンゲージメントモード
 * npx ts-node examples/engagement_script.ts --collect # 収集モード（userId取得）
 * npx ts-node examples/engagement_script.ts --dry-run # ドライラン
 */

import axios from "axios";
import fs from "fs";
import path from "path";

// 環境変数読み込み（.envファイルを手動パース）
function loadEnv(): Record<string, string> {
    // examples/ → threads-automation/ → skills/ → .agent/ → tweets/
    const envPath = path.resolve(__dirname, "../../../../.env");
    const env: Record<string, string> = {};

    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();
                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                env[key] = value;
            }
        }
    }
    return env;
}

const envVars = loadEnv();

// ===== 設定 =====
const DRY_RUN = process.argv.includes("--dry-run");
const COLLECT_MODE = process.argv.includes("--collect");

interface Config {
    // RapidAPI (Meta Threads by Glavier)
    RAPIDAPI_KEY: string;
    RAPIDAPI_HOST: string;

    // 公式Threads API
    THREADS_ACCESS_TOKEN: string;
    THREADS_USER_ID: string;

    // Gemini
    GEMINI_API_KEY: string;
    GEMINI_MODEL: string;

    // データファイル
    STATUS_FILE: string;
    ACCOUNTS_FILE: string;

    // 設定
    ACCOUNT_CONCEPT: string;
    EXCLUDE_WORDS: string[];
}

const CONFIG: Config = {
    RAPIDAPI_KEY: envVars.RAPIDAPI_KEY || "",
    // cavsn API: Threads by Meta | Detailed
    RAPIDAPI_HOST: envVars.THREADS_RAPIDAPI_HOST || "threads-by-meta-threads-an-instagram-app-detailed.p.rapidapi.com",

    THREADS_ACCESS_TOKEN: envVars.THREADS_ACCESS_TOKEN || "",
    THREADS_USER_ID: envVars.THREADS_USER_ID || "",

    GEMINI_API_KEY: envVars.GEMINI_API_KEY_1 || "",
    GEMINI_MODEL: "gemini-2.5-flash",

    STATUS_FILE: path.join(__dirname, "../data/engagement_status.json"),
    ACCOUNTS_FILE: path.join(__dirname, "../data/target_accounts.json"),

    ACCOUNT_CONCEPT: `
このアカウントはターゲット層に対して価値を提供するアカウントです。
発信スタイルは、共感を示しつつ自然にエンゲージメントを促す形です。
※ここをあなたのアカウントコンセプトに書き換えてください
  `,

    EXCLUDE_WORDS: ["宣伝", "PR", "#ad", "予約", "営業中", "販売", "セール", "キャンペーン", "プレゼント"],
};

// ===== 型定義 =====
interface TargetAccount {
    username: string;
    userId?: string;  // RapidAPIで取得した数値ID
    name?: string;
    followers?: number;
    addedAt: string;
    lastCheck?: string;
}

interface EngagementStatus {
    quotedPostIds: string[];
}

interface ThreadsPost {
    pk: string;
    code: string;
    text: string;
    taken_at: number;
    like_count: number;
    username: string;
}

interface AIResult {
    isRelevant: boolean;
    score: number;
    reason?: string;
    comment?: string;
}

// ===== データ管理 =====
function ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadData<T>(filePath: string, defaultData: T): T {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
        } catch {
            console.warn(`⚠️ Failed to parse ${filePath}, using default.`);
        }
    }
    return defaultData;
}

function saveData<T>(filePath: string, data: T): void {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ===== RapidAPI: Meta Threads (Glavier) =====
const rapidApiHeaders = {
    "x-rapidapi-key": CONFIG.RAPIDAPI_KEY,
    "x-rapidapi-host": CONFIG.RAPIDAPI_HOST,
};

async function getThreadsUserIdFromApi(username: string): Promise<string | null> {
    try {
        // cavsn API: /get_id_from_username
        console.log(`  📡 Calling: https://${CONFIG.RAPIDAPI_HOST}/get_id_from_username?username=${username}`);
        const response = await axios.get(
            `https://${CONFIG.RAPIDAPI_HOST}/get_id_from_username`,
            {
                params: { username },
                headers: rapidApiHeaders,
            }
        );
        console.log(`  📥 Response:`, JSON.stringify(response.data, null, 2));
        // cavsn APIレスポンス形式: { user_id: "123456" } または { id: "123456" }
        return response.data?.user_id || response.data?.id || null;
    } catch (error: any) {
        console.error(`❌ Failed to get user ID for @${username}:`);
        console.error(`  Status: ${error.response?.status}`);
        console.error(`  Data: ${JSON.stringify(error.response?.data)}`);
        return null;
    }
}

async function getUserThreads(userId: string, username: string): Promise<ThreadsPost[]> {
    try {
        // cavsn API: /get_user_threads
        console.log(`  📡 Calling: https://${CONFIG.RAPIDAPI_HOST}/get_user_threads?user_id=${userId}`);
        const response = await axios.get(
            `https://${CONFIG.RAPIDAPI_HOST}/get_user_threads`,
            {
                params: { user_id: userId },
                headers: rapidApiHeaders,
            }
        );

        console.log(`  📥 Response keys:`, Object.keys(response.data || {}).join(", "));

        // cavsn APIレスポンス形式を解析
        // threads配列またはitemsなど様々な形式に対応
        const threads = response.data?.threads || response.data?.items || response.data?.data?.threads || [];

        return threads.map((t: any) => {
            // 投稿データの構造に応じてパース
            const post = t.post || t.thread_items?.[0]?.post || t;
            return {
                pk: String(post?.pk || post?.id || ""),
                code: post?.code || "",
                text: post?.caption?.text || post?.text || "",
                taken_at: post?.taken_at || 0,
                like_count: post?.like_count || 0,
                username,
            };
        }).filter((p: ThreadsPost) => p.pk && p.text);
    } catch (error: any) {
        console.error(`❌ Failed to get threads for user ${userId}:`);
        console.error(`  Status: ${error.response?.status}`);
        console.error(`  Data: ${JSON.stringify(error.response?.data)}`);
        return [];
    }
}

// 1回のAPIコールでユーザー情報と投稿を取得（API節約用）
async function getUserDetailsAndThreads(username: string): Promise<{ userId: string; posts: ThreadsPost[] } | null> {
    try {
        console.log(`  📡 Calling: https://${CONFIG.RAPIDAPI_HOST}/v1/user/details_and_threads/?username=${username}`);
        const response = await axios.get(
            `https://${CONFIG.RAPIDAPI_HOST}/v1/user/details_and_threads/`,
            {
                params: { username },
                headers: rapidApiHeaders,
            }
        );

        console.log(`  📥 Response received (keys: ${Object.keys(response.data || {}).join(", ")})`);
        const data = response.data;
        const threads = data?.threads || [];

        return {
            userId: data?.user_id || "",
            posts: threads.map((t: any) => {
                // threads配列の構造に応じてパースを調整
                const postId = t.identifier?.find((i: any) => i.propertyID === "Post")?.value || "";
                return {
                    pk: postId,
                    code: t.identifier?.find((i: any) => i.propertyID === "Post Shortcode")?.value || "",
                    text: t.articleBody || t.headline || "",
                    taken_at: t.dateCreated ? new Date(t.dateCreated).getTime() / 1000 : 0,
                    like_count: 0,
                    username,
                };
            }),
        };
    } catch (error: any) {
        console.error(`❌ Failed to get details for @${username}:`);
        console.error(`  Status: ${error.response?.status}`);
        console.error(`  Data: ${JSON.stringify(error.response?.data)}`);
        return null;
    }
}

// ===== 公式Threads API: 引用投稿 =====
async function publishQuotePost(quotePostId: string, text: string): Promise<string | null> {
    if (!CONFIG.THREADS_ACCESS_TOKEN || !CONFIG.THREADS_USER_ID) {
        console.error("❌ Threads credentials not configured");
        return null;
    }

    const baseUrl = "https://graph.threads.net";

    try {
        // Step 1: メディアコンテナ作成
        const containerResponse = await axios.post<{ id: string }>(
            `${baseUrl}/${CONFIG.THREADS_USER_ID}/threads`,
            {
                media_type: "TEXT",
                text,
                quote_post_id: quotePostId,
                access_token: CONFIG.THREADS_ACCESS_TOKEN,
            }
        );

        const creationId = containerResponse.data?.id;
        if (!creationId) {
            throw new Error("Failed to create media container");
        }

        // Step 2: 公開
        const publishResponse = await axios.post<{ id: string }>(
            `${baseUrl}/${CONFIG.THREADS_USER_ID}/threads_publish`,
            {
                creation_id: creationId,
                access_token: CONFIG.THREADS_ACCESS_TOKEN,
            }
        );

        return publishResponse.data?.id || null;
    } catch (error) {
        console.error("❌ Threads publish error:", (error as Error).message);
        return null;
    }
}

// ===== AI評価 (Gemini) =====
async function evaluateWithGemini(post: ThreadsPost): Promise<AIResult> {
    if (!CONFIG.GEMINI_API_KEY) {
        console.warn("⚠️ Gemini API key not set, using default response");
        return { isRelevant: true, score: 50, comment: "これ共感する👀" };
    }

    const prompt = `
あなたはSNSマーケティングの専門家です。以下のThreads投稿を評価してください。

【アカウントコンセプト】
${CONFIG.ACCOUNT_CONCEPT}

【評価投稿】
@${post.username}: ${post.text}

【タスク】
1. 適合性判断: ターゲット層に有益で、引用して違和感がないか？
   - 除外条件: 宣伝、スパム、ネガティブ、政治的内容、RTキャンペーン
2. コメント生成: 適合する場合、20-30文字で共感や学びを示す自然なコメント。絵文字1個推奨。

出力は必ずJSON形式で: { "isRelevant": true/false, "score": 0-100, "reason": "...", "comment": "..." }
`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent`,
            {
                contents: [{ parts: [{ text: prompt }] }],
            },
            {
                params: { key: CONFIG.GEMINI_API_KEY },
                headers: { "Content-Type": "application/json" },
            }
        );

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) as AIResult : { isRelevant: false, score: 0 };
    } catch (error) {
        console.error("❌ Gemini error:", (error as Error).message);
        return { isRelevant: false, score: 0 };
    }
}

// ===== 収集モード: ターゲットアカウントのuserIdを取得 =====
async function runCollectionMode(): Promise<void> {
    console.log("🕵️ Collection Mode: Fetching user IDs for target accounts...\n");

    const accounts: TargetAccount[] = loadData(CONFIG.ACCOUNTS_FILE, []);

    if (accounts.length === 0) {
        console.log("⚠️ No target accounts found. Add accounts to data/target_accounts.json first:");
        console.log(`
Example format:
[
  { "username": "competitor1", "addedAt": "2026-01-17" },
  { "username": "competitor2", "addedAt": "2026-01-17" }
]
`);
        return;
    }

    let updatedCount = 0;
    for (const account of accounts) {
        if (account.userId) {
            console.log(`✓ @${account.username} already has userId: ${account.userId}`);
            continue;
        }

        console.log(`🔍 Fetching data for @${account.username}...`);

        // まずgetUserDetailsAndThreadsを試す（userIdと投稿を同時取得）
        const result = await getUserDetailsAndThreads(account.username);

        if (result && result.userId) {
            account.userId = result.userId;
            updatedCount++;
            console.log(`  ✅ Got userId: ${result.userId}`);
            console.log(`  📝 Found ${result.posts.length} posts`);
        } else {
            // フォールバック: getThreadsUserIdFromApiを試す
            console.log(`  ⚠️ Trying fallback API...`);
            const userId = await getThreadsUserIdFromApi(account.username);
            if (userId) {
                account.userId = userId;
                updatedCount++;
                console.log(`  ✅ Got userId: ${userId}`);
            } else {
                console.log(`  ❌ Failed to get userId`);
            }
        }

        // Rate limit対策
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    saveData(CONFIG.ACCOUNTS_FILE, accounts);
    console.log(`\n✅ Collection complete. Updated ${updatedCount} accounts.`);
}

// ===== エンゲージメントモード =====
async function runEngagementMode(): Promise<void> {
    console.log(`🚀 Engagement Mode ${DRY_RUN ? "[DRY RUN]" : "[LIVE]"}\n`);

    const accounts: TargetAccount[] = loadData(CONFIG.ACCOUNTS_FILE, []);
    const accountsWithUserId = accounts.filter(a => a.userId);

    if (accountsWithUserId.length === 0) {
        console.warn("⚠️ No target accounts with userId. Run with --collect first.");
        return;
    }

    // ランダムに1アカウント選択（API節約のため）
    const target = accountsWithUserId[Math.floor(Math.random() * accountsWithUserId.length)];
    console.log(`👀 Checking: @${target.username} (userId: ${target.userId})\n`);

    // 投稿取得
    const posts = await getUserThreads(target.userId!, target.username);
    console.log(`  📝 Found ${posts.length} posts`);

    if (posts.length === 0) {
        console.log("  → No posts found.");
        return;
    }

    // ステータス読み込み
    const status: EngagementStatus = loadData(CONFIG.STATUS_FILE, { quotedPostIds: [] });

    // フィルタリング（24時間以内 & 引用済み除外 & 除外ワード）
    const now = Date.now() / 1000;
    const candidates = posts.filter(p => {
        // 引用済みチェック
        if (status.quotedPostIds.includes(p.pk)) return false;

        // 24時間以内
        if (p.taken_at > 0 && (now - p.taken_at) > 24 * 60 * 60) return false;

        // 除外ワードチェック
        const textLower = p.text.toLowerCase();
        if (CONFIG.EXCLUDE_WORDS.some(w => textLower.includes(w.toLowerCase()))) return false;

        // テキストが空でない
        if (!p.text.trim()) return false;

        return true;
    });

    console.log(`  🎯 ${candidates.length} candidates after filtering`);

    if (candidates.length === 0) {
        console.log("  → No suitable posts found.");
        return;
    }

    // 最新投稿をAI評価
    const bestPost = candidates[0];
    console.log(`\n📊 Evaluating post: "${bestPost.text.slice(0, 50)}..."`);

    const aiResult = await evaluateWithGemini(bestPost);
    console.log(`  AI Score: ${aiResult.score}, Relevant: ${aiResult.isRelevant}`);
    if (aiResult.reason) console.log(`  Reason: ${aiResult.reason}`);

    if (aiResult.isRelevant && aiResult.score >= 60 && aiResult.comment) {
        console.log(`\n🎯 Target locked!`);
        console.log(`  Post: ${bestPost.text.slice(0, 80)}...`);
        console.log(`  Comment: ${aiResult.comment}`);
        console.log(`  Post ID (pk): ${bestPost.pk}`);

        if (DRY_RUN) {
            console.log(`\n[DRY RUN] Would publish quote post with pk: ${bestPost.pk}`);
        } else {
            const publishedId = await publishQuotePost(bestPost.pk, aiResult.comment);
            if (publishedId) {
                console.log(`\n✅ Posted successfully! ID: ${publishedId}`);
                status.quotedPostIds.push(bestPost.pk);
                if (status.quotedPostIds.length > 100) status.quotedPostIds.shift();
                saveData(CONFIG.STATUS_FILE, status);
            }
        }
    } else {
        console.log("\n⚠️ Post not suitable for engagement.");
    }
}

// ===== メイン =====
async function main(): Promise<void> {
    console.log("=".repeat(50));
    console.log("Threads Engagement Script");
    console.log("=".repeat(50) + "\n");

    if (!CONFIG.RAPIDAPI_KEY) {
        console.error("❌ RAPIDAPI_KEY is required. Set it in .env file.");
        return;
    }

    if (COLLECT_MODE) {
        await runCollectionMode();
    } else {
        await runEngagementMode();
    }
}

main().catch(console.error);
