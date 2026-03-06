---
description: 自動ドラフト生成 (Auto Generate Drafts)
---

# 自動ドラフト生成ワークフロー

このスキルは、`.github/workflows/auto-generate-drafts.yml` で行われている「下書き（ドラフト）の自動生成」を **API(Gemini等)にプログラムから外部リクエストするのではなく、AIアシスタント自身（あなた）が直接考案・生成して保存する** ための手順です。

## 前提条件
- リポジトリルートで実行すること
- Firebase接続情報などがプロジェクトルートの `.env` に設定されていること

## ステップ

### 1. 対象アカウントとコンテキストの取得
まず、ドラフトが不足している（5件未満）アカウントと、生成に必要な情報（過去の投稿、コンセプトなど）を取得します。

**AI アシスタントへの指示:**
以下のコマンドを実行し、ファイルに出力されたJSONデータを元にコンテキストを把握してください。

```bash
npx tsx -r dotenv/config .agent/workflows/scripts/get_accounts.ts > context.json
```
続いて `context.json` を全件読み込んでください。

### 2. ドラフトの生成（あなたのタスク）
読み込んだ `context.json` には、アカウントごとに以下の情報が含まれています。
- `concept`: アカウントのコンセプト
- `neededCount`: 必要なドラフト数
- `payload`: `topPosts`, `referencePosts`, `recentPosts`, `exemplaryPosts`, `tips` などの過去の文脈・事例が含まれます。

**AI アシスタントへの指示:**
取得した各アカウントについて、`neededCount` で指定された数だけ新しいドラフト文（プラットフォームの特性に合わせて140文字推奨など）を **あなた自身の知能で考案** してください。
- 過去の投稿 (`recentPosts`, `topPosts`) のトーン＆マナーを踏襲すること
- `exemplaryPosts` や `tips` の書き方を参考にすること
- 既存の `drafts` と全く同じ内容にならないようにすること

生成したドラフトは以下の JSON フォーマットの配列にまとめ、一時ファイル `generated_drafts.json` に保存してください（ファイル出力ツールを用いてください）。

```json
[
  {
    "accountId": "アカウントのID",
    "platform": "x" または "threads",
    "text": "生成したドラフト内容のテキスト1"
  },
  {
    "accountId": "アカウントのID",
    "platform": "x" または "threads",
    "text": "生成したドラフト内容のテキスト2"
  }
]
```

### 3. ドラフトの保存
**AI アシスタントへの指示:**
一時ファイル `generated_drafts.json` の作成が完了したら、以下のコマンドを実行してFirestoreに保存してください。

```bash
npx tsx -r dotenv/config .agent/workflows/scripts/save_drafts.ts generated_drafts.json
```

保存が無事に完了したことを確認したら、一時ファイル（`context.json`, `generated_drafts.json`）を削除し、ユーザーに完了を報告してください。
