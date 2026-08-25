import { DashboardClient } from "./client";
import { getRapidApiUsage } from "@/lib/services/firestore.server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const errors = {
    accountsError: false,
    draftsError: false,
    accountDataError: false,
    quotaExceeded: false,
  };

  const apiUsageResult =
    process.env.NEXT_PHASE === "phase-production-build"
      ? []
      : await Promise.allSettled([getRapidApiUsage()]);

  const apiUsage =
    apiUsageResult[0]?.status === "fulfilled"
      ? apiUsageResult[0].value
      : { month: "", count: 0 };

  return (
    <DashboardClient
      initialApiUsage={apiUsage}
      initialDrafts={[]}
      initialAccountData={null}
      errors={errors}
    />
  );
}
