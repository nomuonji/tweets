import { DateTime } from "luxon";
import { executeDueSchedules } from "@/lib/services/scheduler-service";

async function main() {
  const result = await executeDueSchedules(DateTime.utc().toISO());
  console.log("Schedule execution result", JSON.stringify(result, null, 2));

  const unhealthyAccounts = [
    ...result.noDraftAccountIds,
    ...result.failedAccountIds,
  ];
  if (unhealthyAccounts.length > 0) {
    console.error(
      `::error title=Auto-post accounts need attention::${unhealthyAccounts.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Schedule execution failed", error);
  process.exit(1);
});
