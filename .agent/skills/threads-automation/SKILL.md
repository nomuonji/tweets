---
name: Threads Automation via Official API
description: Meta公式Threads Graph APIを使用したデータ収集・解析およびAIを活用した自動エンゲージメントシステムの実装ガイド。競合アカウントへの引用投稿によるエンゲージメント戦略に対応。
---

# Threads Automation via Official API

このスキルは、競合アカウントの投稿に対して引用投稿（Quote Post）で反応する自動エンゲージメント機能を実装するためのガイドです。

## アーキテクチャ概要

```
┌────────────────────────────────────────────────────────────┐
│  RapidAPI（Meta Threads by Glavier）                        │
│  ・競合アカウントの投稿一覧を取得                              │
│  ・User ID / User Threads / User Details & Threads           │
│  ・無料枠: 100リクエスト/月                                   │
└───────────────────────┬────────────────────────────────────┘
                        │ 投稿データ（pk, text, timestamp）
                        ▼
┌────────────────────────────────────────────────────────────┐
│  AI評価（Gemini）                                            │
│  ・投稿の適合性判断                                          │
│  ・引用コメント生成                                          │
└───────────────────────┬────────────────────────────────────┘
                        │ 適合する投稿 + コメント
                        ▼
┌────────────────────────────────────────────────────────────┐
│  公式Threads API（graph.threads.net）                        │
│  ・引用投稿を作成（quote_post_id指定）                        │
│  ・返信を作成（reply_to_id指定）                              │
└────────────────────────────────────────────────────────────┘
```

## 1. 基本設定

### 必要なAPI

| API | 用途 | 認証 |
|-----|------|------|
| Meta Threads (Glavier) via RapidAPI | 競合投稿の取得 | RapidAPI Key |
| 公式Threads API | 引用投稿・返信の実行 | OAuth Token |

### 環境変数 (.env)

```env
# RapidAPI (競合投稿取得用)
RAPIDAPI_KEY=your_rapidapi_key
THREADS_RAPIDAPI_HOST=meta-threads.p.rapidapi.com

# 公式Threads API (投稿用)
THREADS_APP_ID=your_app_id
THREADS_APP_SECRET=your_app_secret
THREADS_ACCESS_TOKEN=your_access_token
THREADS_USER_ID=your_user_id
```

## 2. RapidAPI: Meta Threads (Glavier)

### 2.1 エンドポイント一覧

| エンドポイント | 機能 | パラメータ |
|--------------|------|-----------|
| `GET /user/id` | ユーザー名→数値ID変換 | `username` |
| `GET /user/threads` | **投稿一覧取得** ⭐ | `user_id` |
| `GET /user/details_and_threads` | プロフィール+投稿を一括 | `username` |
| `GET /user/replies` | 返信一覧取得 | `user_id` |
| `GET /user/details` | 詳細プロフィール | `user_id` |

### 2.2 ユーザーID取得

```typescript
async function getThreadsUserId(username: string): Promise<string> {
  const response = await axios.get(
    "https://meta-threads.p.rapidapi.com/user/id",
    {
      params: { username },
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "meta-threads.p.rapidapi.com",
      },
    }
  );
  return response.data.data.user_id;
}
```

### 2.3 ユーザーの投稿一覧取得

```typescript
interface ThreadsPost {
  pk: string;           // 投稿ID（公式APIで使用）
  code: string;         // ショートコード
  text: string;         // 投稿テキスト
  taken_at: number;     // Unix timestamp
  like_count: number;
}

async function getUserThreads(userId: string): Promise<ThreadsPost[]> {
  const response = await axios.get(
    "https://meta-threads.p.rapidapi.com/user/threads",
    {
      params: { user_id: userId },
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "meta-threads.p.rapidapi.com",
      },
    }
  );
  
  const threads = response.data.data?.mediaData?.threads || [];
  return threads.map((t: any) => ({
    pk: t.post.pk,
    code: t.post.code,
    text: t.post.caption?.text || "",
    taken_at: t.post.taken_at,
    like_count: t.post.like_count || 0,
  }));
}
```

### 2.4 ユーザー名から直接投稿取得（1回のAPIコール）

```typescript
async function getUserDetailsAndThreads(username: string) {
  const response = await axios.get(
    "https://meta-threads.p.rapidapi.com/user/details_and_threads",
    {
      params: { username },
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "meta-threads.p.rapidapi.com",
      },
    }
  );
  
  return {
    userId: response.data.user_id,
    threads: response.data.threads || [],
  };
}
```

## 3. 公式Threads API: 引用投稿

このプロジェクトの `src/lib/platforms/threads.ts` に既に実装済み：

```typescript
import { publishThreadsQuotePost } from "@/lib/platforms/threads";

// 引用投稿を作成
const result = await publishThreadsQuotePost(account, {
  text: "これめっちゃ共感する👀",
  quotePostId: "3140571811702861209",  // RapidAPIで取得したpk
});
```

## 4. 競合エンゲージメント戦略

### 4.1 ターゲットアカウント管理

```typescript
// data/target_accounts.json
interface TargetAccount {
  username: string;
  userId?: string;       // RapidAPIで取得した数値ID
  name?: string;
  followers?: number;
  addedAt: string;
  lastCheck?: string;
}
```

### 4.2 運用ワークフロー

```
[初回セットアップ]
1. 競合アカウントのusernameをリストに追加
2. User ID APIで数値IDを取得して保存
   ※この処理は1回だけでOK

[毎日の自動化（GitHub Actions等）]
1. ターゲットから今日チェックするアカウントを選択
2. User Threads APIで最新投稿を取得
3. 24時間以内の投稿をフィルタリング
4. AIで適合性を評価 & コメント生成
5. 適合する場合、公式APIで引用投稿
```

### 4.3 無料枠の使い方

```
月100リクエストの最適運用：

方法A: 毎日3アカウント監視
- 1日3リクエスト × 30日 = 90リクエスト

方法B: User Details & Threads を使用
- ユーザー名から直接投稿取得
- User ID取得が不要（初回のAPIコールを節約）
```

## 5. AI (Gemini) との連携

### プロンプト設計例

```typescript
const prompt = `
あなたはSNSマーケティングの専門家です。以下のThreads投稿を評価してください。

【アカウントコンセプト】
${ACCOUNT_CONCEPT}

【評価投稿】
@${post.username}: ${post.text}

【タスク】
1. 適合性判断: ターゲット層に有益で、引用して違和感がないか？
   - 除外: 宣伝、スパム、ネガティブ、政治的内容、RTキャンペーン
2. コメント生成: 適合する場合、20-30文字の自然なコメント

出力JSON: { "isRelevant": bool, "score": 0-100, "comment": "..." }
`;
```

## 6. 注意事項

### API制限

| API | 制限 |
|-----|------|
| RapidAPI (Glavier) | 無料: 100リクエスト/月 |
| 公式Threads API | レート制限あり（詳細はMeta Docsを確認） |

### 引用投稿の制限
- ユーザーは引用許可を設定可能（Anyone / Profiles I follow / Mentioned only）
- 引用が無効化されている投稿には引用投稿できません

### トークン管理
- 公式APIのアクセストークンは有効期限があります（通常60日）
- `src/lib/services/token-service.ts` でリフレッシュ処理を実装済み

## 7. ファイル構成

```
.agent/skills/threads-automation/
├── SKILL.md                    # このファイル
├── data/
│   ├── target_accounts.json    # ターゲットアカウントリスト
│   └── engagement_status.json  # エンゲージメント状態管理
└── examples/
    └── engagement_script.ts    # エンゲージメントスクリプト例
```

## 8. 既存プロジェクトとの統合

| 機能 | ファイル |
|------|----------|
| Threads API基盤 | `src/lib/platforms/threads.ts` |
| 引用投稿 | `publishThreadsQuotePost()` |
| 返信 | `publishThreadsReply()` |
| トークン管理 | `src/lib/services/token-service.ts` |
| Gemini連携 | `src/lib/gemini/client.ts` |

## 9. クイックスタート

```bash
# 1. RapidAPIでMeta Threads APIをサブスクライブ
# https://rapidapi.com/Glavier/api/meta-threads

# 2. .envにRapidAPIキーを設定
# RAPIDAPI_KEY=your_key
# THREADS_RAPIDAPI_HOST=meta-threads.p.rapidapi.com

# 3. 競合アカウントをターゲットリストに追加
# data/target_accounts.json を編集

# 4. エンゲージメントスクリプトを実行
npx ts-node .agent/skills/threads-automation/examples/engagement_script.ts --dry-run
```
