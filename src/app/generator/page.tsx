import { GeneratorClient } from "@/components/generator/generator-client";
import {
  getAccounts,
  getSettings,
  getTopPosts,
  listDrafts,
} from "@/lib/services/firestore.server";
import {
  getPlatformSlotOptions,
  getReservedSlots,
} from "@/lib/services/slot-service";

export default async function GeneratorPage() {
  let candidates: Awaited<ReturnType<typeof getTopPosts>> = [];
  let drafts: Awaited<ReturnType<typeof listDrafts>> = [];
  let accounts: Awaited<ReturnType<typeof getAccounts>> = [];
  let settings: Awaited<ReturnType<typeof getSettings>> = null;
  let hasError = false;

  try {
    const [candidatePosts, draftDocs, accountDocs, settingsDoc] =
      await Promise.all([
        getTopPosts(
          { platform: "all", media_type: "all", period_days: 30 },
          { sort: "top", limit: 20 },
        ),
        listDrafts(),
        getAccounts(),
        getSettings(),
      ]);
    candidates = candidatePosts;
    drafts = draftDocs;
    accounts = accountDocs;
    settings = settingsDoc;
  } catch {
    hasError = true;
  }

  if (!settings || hasError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Generator & Scheduler</h1>
        <p className="text-sm text-muted-foreground">
          Unable to load Firestore data. Confirm settings and credentials are configured.
        </p>
      </div>
    );
  }

  let slotOptions:
    | {
        x: ReturnType<typeof getPlatformSlotOptions>;
        threads: ReturnType<typeof getPlatformSlotOptions>;
      }
    | null = null;

  try {
    const [reservedX, reservedThreads] = await Promise.all([
      getReservedSlots("x"),
      getReservedSlots("threads"),
    ]);

    slotOptions = {
      x: getPlatformSlotOptions(settings, "x", reservedX),
      threads: getPlatformSlotOptions(settings, "threads", reservedThreads),
    };
  } catch {
    hasError = true;
  }

  if (hasError && !slotOptions) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Generator & Scheduler</h1>
        <p className="text-sm text-muted-foreground">
          Unable to load scheduling slots. Check Firestore connectivity.
        </p>
      </div>
    );
  }

  return (
    <GeneratorClient
      candidates={candidates}
      drafts={drafts}
      accounts={accounts}
      slotOptions={slotOptions!}
    />
  );
}
