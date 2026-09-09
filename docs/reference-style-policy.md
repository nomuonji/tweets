# 外部勝ち型の取り込み方針（2026-09-05決定・継続）

## 原則
- 内部データの推測だけでコンセプトを決めない。実際のSNSを実測してから考える。
- 再現の強さの序列：キャラシート > exemplary_posts > 文字数制限 > tips。
- 「パクリくらいの近さでないと再現できない」を前提にする。骨格・改行・語尾まで原文写しで取り込む。

## 参照元の取り込み手順
1. Threadsの実投稿をJina経由で取得する（直fetchはJS壁で空振りする）。
   例: `https://r.jina.ai/https://www.threads.com/@<handle>`
2. 直近投稿の本文・いいね・返信・リポスト数を記録する。フォロワー数も見る
   （フォロワー24人で183いいね139返信のような事例があり、数が少なくても型が有効）。
3. exemplary_postsに原文写しで登録する（改行・関西弁・「笑」・語尾まで維持）。
   変えてよいのは他人への誘導線（例：相手の無料鑑定CTA）だけで、自声への寄せ直しはしない。
4. tipsには `狙い／型／例／NG／実績` の定型メモを残す。作成は `npm run tip:add` 経由
   （`scripts/add-tip.ts` がtitle 80字・text 160字とアカウント存在を検証する）。
   exemplaryの登録は `npm run exemplary:add` 経由（`scripts/add-exemplary.ts`、
   改行は `\n` で渡す。explanation 120字 검증、アカウント存在検証。文字数は参考表示のみ）。
5. アカウントへの紐付けは `selectedTipIds` の明示選択を正規経路にする
   （`account_ids` 経路はUIから書かれない裏口なので併用扱い）。

## パイプラインの既知の仕様（必須知識）
- `reference_accounts` コレクションと `sync:external` はX専用。
  Threadsの参照元はここに入れない（X同期が別人を取ってきて汚染する）。
  Threads由来はtips/exemplaryで取り込む。
- exemplaryは文字数制限を受けないが、プロンプト内で切り詰められる。
  改行リズムは `compactMultiline` で保持する（`src/lib/gemini/prompt.ts`）。
- `min/maxPostLength` が縛るのは生成文の出力長のみ。
- tipsはキャラバージョンの影響を受けない（毎回入る）。ただしシート衝突時はシートが勝つ。
- 生成文が原文に激似で出ることがある。投稿前の目視を必須にする。

## 登録済み（2026-09-05時点）
- tips 8件（新形式 `狙い／型／例／NG／実績`）。IDs:
  EomZzMhsN3wxiaGpqVyH, W2ybkk3lHqDfR0Axm9bP, u0UdKr7GhPggTxnziLec,
  YLUjLuIsqQWa4zpDbiJ3, tip_hiro_list_mtnbovkc, tip_ren_yowasa_mtnc8hmr,
  tip_hiruda_ubengi_mtnc15nj, tip_polar_list_mtnbs6e8
- exemplary_posts 7件:
  threads_date_blueprints 3件（REN 2＋hiro 1）、
  threads_uwaki_neko_xx 2件（hiruda 2）、
  threads_plansetting 2件（polar 2）
- threads_date_blueprints: selectedTipIds=上記2件、minPostLength 120→80。
- threads_uwaki_neko_xx: 2026-09-05に浮気・不倫代弁＋占い層向け保存導線を足し算→v2
  （無印v1だった）。min 120→90。旧draft 5件は失効のため削除し手書き5件を投入。
- threads_plansetting: 2026-09-05にシートをpolar型へ全面置換→v3、
  さらに1投稿依存の指摘を受けアカウント全体人格版に修正→v4、
  経理・簿記1級の虚偽指摘を受け肩書きなし版に修正、
  v3/v4は実質更新なしとして版数をv3に整理（historyのv3/v4削除）、
  手書きdraft 5件をv3で投入。v4生成の2件（簿記2級含む）は投稿前に削除。
- 参照元URL: @hiro_men_polish, @ren_0411_oo, @hiruda_kyouseienmusubi,
  @polar_11381（採用）, @badger.7403075（スキップ）, @growup_nici（見送り）

## 残課題
- threads_date_blueprints / threads_jellyfish.1619959 のsyncが2026-09-03で停止。
- 返信運用（投稿後30分〜1時間の即レス）がないとリプチェーン型は伸びない。
- tip別の効果測定（draftへのtip_ids記録→score紐付け）は未実装。
- かんな min 120がhiruda式短文を縛る可能性（要検討）。
