import { refreshExpiringTokens } from "@/lib/services/token-service";

async function main() {
  await refreshExpiringTokens();
  console.log("Token refresh completed.");
}

main().catch((error) => {
  console.error("Failed to refresh tokens", error);
  process.exit(1);
});
