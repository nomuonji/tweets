const monitoredAccounts = new Set(["threads_chinsukedt", "threads_date_blueprints"]);

/** Only these new reply accounts require an independently confirmed JP tag. */
export function hasVerifiedAmazonAssociatesTag(
  accountId: string,
  productUrl?: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!monitoredAccounts.has(accountId)) return true;
  const tag = env.AMAZON_ASSOCIATES_JP_VERIFIED_TAG?.trim();
  if (!tag || !/^[a-z0-9][a-z0-9-]{0,28}-22$/.test(tag) || !productUrl) return false;
  try {
    const url = new URL(productUrl);
    const tags = url.searchParams.getAll("tag");
    return url.protocol === "https:" &&
      url.hostname === "www.amazon.co.jp" &&
      tags.length === 1 &&
      tags[0] === tag;
  } catch {
    return false;
  }
}
