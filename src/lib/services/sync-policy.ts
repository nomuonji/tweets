import { DateTime } from "luxon";
import type { SyncPostPayload } from "@/lib/platforms/types";
import type { AccountDoc } from "@/lib/types";

export const DEFAULT_STEADY_STATE_FETCH_LIMIT = 20;
export const DEFAULT_METRICS_REFRESH_HOURS = 48;

export function selectPostsForPersistence(
  account: AccountDoc,
  payloads: SyncPostPayload[],
  now: DateTime = DateTime.utc(),
  refreshHours = DEFAULT_METRICS_REFRESH_HOURS,
): SyncPostPayload[] {
  const cursor = account.sync_cursor
    ? DateTime.fromISO(account.sync_cursor).toUTC()
    : null;
  const validCursor = cursor?.isValid ? cursor : null;
  const refreshCutoff = now.minus({ hours: Math.max(0, refreshHours) });
  const selected = new Map<string, SyncPostPayload>();

  for (const payload of payloads) {
    const created = DateTime.fromISO(payload.created_at).toUTC();
    if (!created.isValid) continue;

    const isNew = !validCursor || created > validCursor;
    const needsMetricsRefresh = created >= refreshCutoff;
    if (isNew || needsMetricsRefresh) {
      selected.set(payload.platform_post_id, payload);
    }
  }

  return Array.from(selected.values());
}
