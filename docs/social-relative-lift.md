# SNSの相対伸び率｜Tweets Operator実装

## 導入したもの
- 背景資料: [instagram-agent-skill-ja](https://github.com/Alman-creator-uslog/instagram-agent-skill-ja) (MIT, Jake Schincariol / あるまん)。日本語化された`ig-viral`と`ig-audit`の「自アカウント通常値に対する倍率」という考え方だけを移植。原典のコードは複製していない。
- My Portal共通 Chat Skill: `social-content-evidence-preflight`。動画・キャプション・日本語プレフライトもここから必要時に呼ぶ。正本はMy Portal DBでありGitHubコピーではない。
- 実装: `src/lib/pattern.ts` の既存 `computePatternAnalysis` が、`pattern_stats/{accountId}` に通常の構成パターン別統計に加えて3つの*記述的*フィールドを保存する。既存の `scripts/analyze-patterns.ts`、既存の定期実行・権限・投稿・下書き処理は変更しない。

| 項目 | 定義 |
| --- | --- |
| `medianExposureLift` | その構成パターンの露出中央値 ÷ **同一アカウント**の露出中央値 |
| `maxExposureLift` | その構成パターン内の最高露出 ÷ 同一アカウント中央値 |
| `outliersAtLeast3x` | 同一アカウント中央値の3倍以上の露出を観測したパターン内の投稿数 |

`exposure` はプラットフォームによりXの `impressions` またはThreadsの `views`。既存の内部フィールド `metrics.impressions` に保持されるが、`exposureMetric` のラベルに従う。Views、impressions、reachは互換ではなく、異媒体間で値を直接比較しない。

## データの整合条件
- 比較する標本は既存の `analyze-patterns.ts` が `belongsToCharacterVersion` で現行キャラ版だけに絞り、24hまたは72hの`performance_snapshots`から抽出したもの。観測窓は同一アカウント内でも変えない。
- 露出 `null`、`0`、非数値は分母にもパターンにも含めない。標本が5件未満なら既存処理は更新せず、前の解析値は保持される。
- スコアは `pattern_stats` の既存更新処理からのみ書かれる。`PostDoc`、`posts`、`drafts`、`external_posts`、収集領収書、投稿APIには触らない。
- X/Threadsのテキスト構造は `extractPattern` による大まかな分類。サンプル数、題材、投稿時点、アカウント規模、画像・引用・広告などの交絡を考慮し、3倍という閾値を「合格」や「バズ原因」と読まない。
- 最適化の主目的はReach/Sharing/Conversation/Conversionを混ぜず個別に宣言する。シェア率を算出するなら適切なシェア数と同一窓のreachまたはimpressionsを別途取得する。存在しないリーチ指標を作らない。

## 確認方法
```bash
npm run test:performance-learning
npm run analyze:patterns -- --no-insights
```
後者は本番Firestoreへの分析結果の書き込みを伴うため、資格情報があり実際の更新を意図する場合だけ実行。読み取りだけなら既存のpattern_stats照会ツールで `medianExposureLift` を確認する。ここでは本番ジョブの起動や投稿は行わない。

## 日本語・動画部分
`ig-reel` のフック候補と読み上げ時間、`ig-caption` の可視行、`ig-human` の定型句検査は、まずMy Portalの`social-content-evidence-preflight`に測定手順として組み込んだ。**Tweets Operatorのライブ投稿を機械的に書き換える処理はまだ組み込まない。** 本人合格済みの文体を壊さないよう、良い稿と悪い稿で較正してから非破壊のwarningとして導入を判断する。InstagramのDM、ログイン、投稿権限の追加は行わない。
