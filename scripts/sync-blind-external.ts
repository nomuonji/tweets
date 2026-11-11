import { runBlindExternalDiscovery } from "@/lib/services/blind-discovery-service";

async function main() {
  const result = await runBlindExternalDiscovery();
  console.log("[Blind Discovery]", JSON.stringify(result));
  if (result.status === "locked") {
    process.exitCode = 1;
    return;
  }
  if (result.status === "skipped" && result.reason?.includes("budget")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[Blind Discovery] Failed:", error);
  process.exit(1);
});
