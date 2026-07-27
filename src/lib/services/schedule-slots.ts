import { DateTime } from "luxon";

export const DEFAULT_SCHEDULE_TIMEZONE = "Asia/Tokyo";

/**
 * Timezone the `postSchedule` "HH:mm" strings are expressed in.
 *
 * `process.env.TIMEZONE` is a server-side deployment setting; in a client
 * bundle it is inlined as undefined and this falls back to the default, which
 * is what the schedule editor uses for its preview labels.
 */
export const SCHEDULE_TIMEZONE =
  process.env.TIMEZONE || DEFAULT_SCHEDULE_TIMEZONE;

/**
 * Every slot occurrence that is already due and has not been executed yet,
 * oldest first.
 *
 * Yesterday's occurrences are included so a late-evening slot is still found by
 * a run that happens after midnight — the previous "today only" logic silently
 * dropped those. Slots at or before `lastExecutedAt` are treated as done, which
 * is what makes the scheduler idempotent and lets it catch up after a missed or
 * delayed run.
 */
export function findDueSlots(
  postSchedule: string[],
  now: DateTime,
  lastExecutedAt: DateTime | null,
): DateTime[] {
  const occurrences: DateTime[] = [];

  for (const dayOffset of [-1, 0]) {
    for (const slot of postSchedule) {
      const [hour, minute] = slot.split(":").map(Number);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
      occurrences.push(
        now
          .plus({ days: dayOffset })
          .set({ hour, minute, second: 0, millisecond: 0 }),
      );
    }
  }

  return occurrences
    .filter((occurrence) => occurrence <= now)
    .filter((occurrence) => !lastExecutedAt || occurrence > lastExecutedAt)
    .sort((a, b) => a.toMillis() - b.toMillis());
}

export type SlotDecision =
  /** Publish for `slot`; mark everything up to and including it as done. */
  | { action: "publish"; slot: DateTime }
  /** Everything pending is too stale to post; just advance the marker. */
  | { action: "skip"; consumeThrough: DateTime }
  /** Nothing is due. */
  | { action: "none" };

/**
 * Decide what to do with the pending slots.
 *
 * Publishes at most one post per run, using the *most recent* actionable slot
 * so that a backlog (e.g. after several missed runs) never turns into a burst
 * of posts — the older slots are consumed alongside it.
 *
 * Slots older than `graceMinutes` are dropped rather than published, so a
 * morning post never goes out in the evening.
 */
export function selectSlot(
  dueSlots: DateTime[],
  now: DateTime,
  graceMinutes: number,
): SlotDecision {
  if (dueSlots.length === 0) return { action: "none" };

  const graceCutoff = now.minus({ minutes: graceMinutes });
  const actionable = dueSlots.filter((slot) => slot >= graceCutoff);

  if (actionable.length === 0) {
    return { action: "skip", consumeThrough: dueSlots[dueSlots.length - 1] };
  }

  return { action: "publish", slot: actionable[actionable.length - 1] };
}

/** Next upcoming occurrence of any slot, for showing "次の自動投稿" in the UI. */
export function findNextSlot(
  postSchedule: string[],
  now: DateTime,
): DateTime | null {
  const upcoming: DateTime[] = [];

  for (const dayOffset of [0, 1]) {
    for (const slot of postSchedule) {
      const [hour, minute] = slot.split(":").map(Number);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
      const occurrence = now
        .plus({ days: dayOffset })
        .set({ hour, minute, second: 0, millisecond: 0 });
      if (occurrence > now) upcoming.push(occurrence);
    }
  }

  if (upcoming.length === 0) return null;
  return upcoming.sort((a, b) => a.toMillis() - b.toMillis())[0];
}
