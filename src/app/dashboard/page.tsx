import { cookies } from "next/headers";
import { DashboardClient } from "./client";
import {
  getRapidApiUsage,
  getAccounts,
  listDrafts,
  getAccountDashboardData,
} from "@/lib/services/firestore.server";
import type { AccountDoc, DraftDoc } from "@/lib/types";

const STORAGE_KEY = "selected-account-id";

export default async function DashboardPage() {
  const cookieStore = cookies();

  const errors = {
    accountsError: false,
    draftsError: false,
    accountDataError: false,
    quotaExceeded: false,
  };

  // Fetch global data first
  const [apiUsageResult, accountsResult] = await Promise.allSettled([
    getRapidApiUsage(),
    getAccounts(),
  ]);

  const apiUsage = apiUsageResult.status === "fulfilled" ? apiUsageResult.value : { month: "", count: 0 };
  
  const accounts: AccountDoc[] = accountsResult.status === "fulfilled" ? accountsResult.value : [];
  if (accountsResult.status === "rejected") {
    console.error("Failed to fetch accounts", accountsResult.reason);
    errors.accountsError = true;
  }

  // Determine the initially selected account
  const storedAccountId = cookieStore.get(STORAGE_KEY)?.value ?? null;
  const selectedAccount = accounts.find(acc => acc.id === storedAccountId) ?? accounts[0] ?? null;

  // Fetch data specific to the selected account
  let initialDrafts: DraftDoc[] = [];
  let initialAccountData = null;

  if (selectedAccount) {
    const [draftsResult, accountDataResult] = await Promise.allSettled([
      listDrafts(selectedAccount.id),
      getAccountDashboardData(selectedAccount.id),
    ]);

    if (draftsResult.status === "fulfilled") {
      initialDrafts = draftsResult.value;
    } else {
      console.error("Failed to fetch initial drafts", draftsResult.reason);
      errors.draftsError = true;
    }

    if (accountDataResult.status === "fulfilled") {
      initialAccountData = accountDataResult.value;
    } else {
      console.error("Failed to fetch initial account data", accountDataResult.reason);
      errors.accountDataError = true;
      if ((accountDataResult.reason as { code?: string }).code === "resource-exhausted") {
        errors.quotaExceeded = true;
      }
    }
  }

  return (
    <DashboardClient
      initialAccounts={accounts}
      initialApiUsage={apiUsage}
      initialDrafts={initialDrafts}
      initialAccountData={initialAccountData}
      errors={errors}
    />
  );
}