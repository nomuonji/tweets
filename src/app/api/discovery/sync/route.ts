import { NextResponse } from "next/server";
import { getAccounts } from "@/lib/services/firestore.server";
import { syncExternalDiscovery } from "@/lib/services/external-discovery-service";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.accountIds)
      ? new Set(body.accountIds.filter((id: unknown): id is string => typeof id === "string"))
      : null;
    const accounts = (await getAccounts()).filter(
      (account) =>
        (!requestedIds || requestedIds.has(account.id)) &&
        ((account.discoveryKeywords?.length ?? 0) > 0 ||
          (account.referenceAccountIds?.length ?? 0) > 0),
    );
    const result = [];
    for (const account of accounts) {
      result.push({ accountId: account.id, ...(await syncExternalDiscovery(account)) });
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
