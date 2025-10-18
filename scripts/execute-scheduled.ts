import { DateTime } from "luxon";
import { executeDueSchedules } from "@/lib/services/scheduler-service";

async function main() {
  const count = await executeDueSchedules(DateTime.utc().toISO());
  console.log(`Executed ${count} scheduled drafts.`);
}

main().catch((error) => {
  console.error("Schedule execution failed", error);
  process.exit(1);
});
