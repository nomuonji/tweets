# Amazon Associates tracking setup — Tweets Operator

Accounts: `threads_chinsukedt` and `threads_date_blueprints`.

Three approved and account-assigned products are in the catalog: `B008P5TPO4`, `B0FKBDT8FR`, `B0CWR2368W`. Their URLs include `tag=tweets-sns-22`, but this tag's ownership has NOT been verified. Catalog `amazon_verified` refers to ASIN/product research, not the Associates account.

## Activate only after verifying
1. In the owner's https://affiliate.amazon.co.jp/ account, confirm the exact JP tracking ID and account status. Ensure both Threads account URLs are registered as the owner's promotional properties.
2. Use Associates Central Link Checker (for manually built links) or generate official SiteStripe links to confirm the exact tracking ID and correct product URLs. Update all three product-catalog URLs if the actual ID differs.
3. Add Amazon's required Associates disclosure to each Threads profile/About: `Amazonのアソシエイトとして、[アカウント名]は適格販売により収入を得ています。`. Automatic affiliate replies already require `【PR】`.
4. Set the Vercel production environment variable `AMAZON_ASSOCIATES_JP_VERIFIED_TAG` to the *confirmed* tracking ID and redeploy. Do not set this based only on the code or apparent URL format.

For these two accounts, the reply product selector fails closed until a confirmed tag is configured and equals the exact URL tag. Other accounts are unchanged. The per-account daily limit, post-topic matching, and ad disclosure remain active.

Amazon references:
- https://affiliate.amazon.co.jp/help/node/topic/G6253GFSARDQENZR
- https://affiliate.amazon.co.jp/help/node/topic/GHQNZAU6669EZS98
- https://affiliate.amazon.co.jp/help/operating/agreement
