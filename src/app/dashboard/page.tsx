import { cookies } from "next/headers";
import {
  getAccounts,
  getAccountDashboardData,
  getRapidApiUsage,
  listDrafts,
  getAllTips, // Add this import
} from "@/lib/services/firestore.server";
import { DashboardClient } from "./client"; // Import the new client component

const STORAGE_KEY = "selected-account-id";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = cookies();

  // Fetch all data in parallel
  const [apiUsageResult, accountsResult, allTipsResult] = await Promise.allSettled([
    getRapidApiUsage(),
    getAccounts(),
    getAllTips(),
  ]);

  const apiUsage = apiUsageResult.status === 'fulfilled' ? apiUsageResult.value : { month: "", count: 0 };
  const accounts = accountsResult.status === 'fulfilled' ? accountsResult.value : [];
  const allTips = allTipsResult.status === 'fulfilled' ? allTipsResult.value : [];
  const accountsError = accountsResult.status === 'rejected';

  const storedAccountId = cookieStore.get(STORAGE_KEY)?.value ?? null;
  const selectedAccount =
    accounts.find((account) => account.id === storedAccountId) ??
    accounts[0] ??
    null;

  let drafts: Awaited<ReturnType<typeof listDrafts>> = [];
  let draftsError = false;
  let accountData: Awaited<ReturnType<typeof getAccountDashboardData>> | null = null;
  let quotaExceeded = false;
  let accountDataError = false;

  if (selectedAccount) {
    try {
      // These depend on selectedAccount, so fetch them sequentially
      const [draftsResult, accountDataResult] = await Promise.allSettled([
        listDrafts({ accountId: selectedAccount.id, limit: 20 }),
        getAccountDashboardData(selectedAccount.id, { recentLimit: 5 }),
      ]);

      if (draftsResult.status === 'fulfilled') {
        drafts = draftsResult.value;
      } else {
        draftsError = true;
        console.error("[Dashboard] Failed to load drafts", draftsResult.reason);
      }

      if (accountDataResult.status === 'fulfilled') {
        accountData = accountDataResult.value;
      } else {
        accountDataError = true;
        const error = accountDataResult.reason;
        const code = (error as { code?: string }).code;
        const message = (error as Error).message ?? "";
        const isQuota =
          code === "firestore/quota-exceeded" ||
          (typeof code === "string" && code.toLowerCase().includes("resource")) ||
          message.includes("quota");
        if (isQuota) {
          quotaExceeded = true;
        } else {
          console.error("[Dashboard] Failed to load account data", error);
        }
      }
    } catch (error) {
        // Catch any unexpected error from the sequential fetches
        accountDataError = true;
        console.error("[Dashboard] Unexpected error fetching account details", error);
    }
  }

  return (
    <DashboardClient
      initialAccounts={accounts}
      initialSelectedAccountId={selectedAccount?.id ?? null}
      initialApiUsage={apiUsage}
      initialDrafts={drafts}
      initialAccountData={accountData}
      allTips={allTips}
      errors={{
        accountsError,
        draftsError,
        accountDataError,
        quotaExceeded,
      }}
    />
  );
}
