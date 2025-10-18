import Link from "next/link";
import {
  getAccounts,
  getDashboardSummary,
  getRapidApiUsage,
  getRecentPostsByAccount,
} from "@/lib/services/firestore.server";
import { toTitleCase } from "@/lib/utils";
import { AddAccountButton } from "@/components/add-account-button";
import { SyncControls } from "@/components/sync-controls";
import { SmartTweetGenerator } from "@/components/smart-tweet-generator";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let apiUsage = { month: "", count: 0 };
  try {
    apiUsage = await getRapidApiUsage();
  } catch {
    apiUsage = { month: "", count: 0 };
  }

  const [overviewResult, accountsResult] = await Promise.allSettled([
    getDashboardSummary(),
    getAccounts(),
  ]);

  const overview =
    overviewResult.status === "fulfilled" ? overviewResult.value : [];
  const hasError = overviewResult.status === "rejected";

  const allAccounts =
    accountsResult.status === "fulfilled" ? accountsResult.value : [];

  const recentPostsByAccount = await Promise.all(
    overview.map(async ({ account }) => ({
      accountId: account.id,
      posts: await getRecentPostsByAccount(account.id, 5),
    })),
  );

  const accountOptions =
    allAccounts.length > 0
      ? allAccounts.map((account) => ({
          id: account.id,
          handle: account.handle,
          displayName: account.display_name,
          platform: account.platform,
        }))
      : overview.map(({ account }) => ({
          id: account.id,
          handle: account.handle,
          displayName: account.display_name,
          platform: account.platform,
        }));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Monitor connected accounts, usage, and top performing posts.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Score = (likes × 2 + reposts × 3 + replies + link clicks × 2) ÷ impressions. A higher score means stronger engagement.
        </p>
      </div>
        <div className="flex flex-wrap gap-3">
          <AddAccountButton />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            RapidAPI Twitter usage
          </p>
          <p className="mt-2 text-2xl font-semibold">{apiUsage.count}</p>
          <p className="text-xs text-muted-foreground">
            Month: {apiUsage.month || "N/A"}
          </p>
        </div>
        <div className="md:col-span-2">
          <SyncControls accounts={accountOptions} />
        </div>
      </div>

      <SmartTweetGenerator accounts={accountOptions} />

      {hasError && (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Failed to load dashboard data. Ensure Firebase credentials are configured.
        </p>
      )}

      {!hasError && overview.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No dashboard data available yet. Connect accounts and run a sync.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {overview.map(({ account, stats }) => {
          const recent = recentPostsByAccount.find(
            (entry) => entry.accountId === account.id,
          )?.posts;

          return (
            <div
              key={account.id}
              className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {toTitleCase(account.platform)}
                  </p>
                  <h2 className="text-xl font-semibold">@{account.handle}</h2>
                  <p className="text-sm text-muted-foreground">
                    {account.display_name}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    account.connected
                      ? "bg-surface-active text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {account.connected ? "Connected" : "Disconnected"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">Posts</p>
                  <p className="text-lg font-semibold">{stats.postCount}</p>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">Avg ER</p>
                  <p className="text-lg font-semibold">
                    {(stats.averageEngagement * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">Best Score</p>
                  <p className="text-lg font-semibold">
                    {stats.bestPost ? stats.bestPost.score.toFixed(3) : "-"}
                  </p>
                </div>
              </div>

              {stats.bestPost ? (
                <Link
                  href={stats.bestPost.url ?? "#"}
                  target="_blank"
                  className="block rounded-lg border border-border bg-background p-4 text-sm transition hover:border-primary"
                >
                  <p className="line-clamp-3 text-muted-foreground">
                    {stats.bestPost.text}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
                      📈 {stats.bestPost.metrics.impressions ?? "n/a"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-700">
                      👍 {stats.bestPost.metrics.likes}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-700">
                      🔁 {stats.bestPost.metrics.reposts_or_rethreads}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700">
                      💬 {stats.bestPost.metrics.replies}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${
                        stats.bestPost.score >= 0.5
                          ? "bg-emerald-600/15 text-emerald-700"
                          : stats.bestPost.score >= 0.2
                            ? "bg-amber-500/15 text-amber-700"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      ⭐ {stats.bestPost.score.toFixed(3)}
                    </span>
                  </div>
                </Link>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No posts yet. Run a sync to fetch the latest content.
                </p>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Recent posts</p>
                {recent && recent.length > 0 ? (
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {recent.map((post) => (
                      <li
                        key={post.id}
                        className="rounded-md border border-border bg-background px-3 py-2"
                      >
                        <p className="line-clamp-2">{post.text}</p>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span>{new Date(post.created_at).toLocaleString()}</span>
                          <span>Score: {post.score.toFixed(3)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
                            📈 {post.metrics.impressions ?? "n/a"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-700">
                            👍 {post.metrics.likes}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-700">
                            🔁 {post.metrics.reposts_or_rethreads}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700">
                            💬 {post.metrics.replies}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    No posts found for this account.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
