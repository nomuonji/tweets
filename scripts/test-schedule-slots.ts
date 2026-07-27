/**
 * Regression checks for auto-post slot selection.
 *
 * These cover the cases that previously caused posts to be silently skipped:
 * a late cron run, and a slot falling either side of midnight.
 *
 *   npm run test:slots
 */
import { DateTime } from "luxon";
import {
  findDueSlots,
  findNextSlot,
  selectSlot,
} from "../src/lib/services/schedule-slots";

const TZ = "Asia/Tokyo";
const jst = (iso: string) => DateTime.fromISO(iso, { zone: TZ });

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
  }
}

const fmt = (list: DateTime[]) =>
  list.map((d) => d.setZone(TZ).toFormat("MM-dd HH:mm"));

console.log("\n1) Late cron run - the old 59-minute window dropped these");
{
  const now = jst("2026-07-27T11:15:00");
  const due = findDueSlots(["10:05"], now, jst("2026-07-27T09:00:00"));
  check("10:05 slot still found at 11:15", fmt(due), ["07-27 10:05"]);
}

console.log("\n2) Midnight crossing - old logic only ever built 'today'");
{
  const now = jst("2026-07-28T00:10:00");
  const due = findDueSlots(["23:50"], now, jst("2026-07-27T20:00:00"));
  check("23:50 slot found after midnight", fmt(due), ["07-27 23:50"]);
}

console.log("\n3) Idempotency - an executed slot is never repeated");
{
  const now = jst("2026-07-27T11:00:00");
  const due = findDueSlots(["10:00"], now, jst("2026-07-27T10:00:00"));
  check("slot equal to lastExecutedAt is excluded", fmt(due), []);
}

console.log("\n4) Backlog is ordered oldest-first");
{
  const now = jst("2026-07-27T13:00:00");
  const due = findDueSlots(
    ["07:00", "12:00", "10:00"],
    now,
    jst("2026-07-27T06:00:00"),
  );
  check("three due slots, sorted", fmt(due), [
    "07-27 07:00",
    "07-27 10:00",
    "07-27 12:00",
  ]);
}

console.log("\n5) Future slots are not due");
{
  const now = jst("2026-07-27T09:00:00");
  // With no history, yesterday's 18:00 is genuinely an unexecuted past slot,
  // so findDueSlots reports it; the grace window (case 9) is what discards it.
  const due = findDueSlots(["18:00"], now, null);
  check("today's 18:00 is not due yet", fmt(due), ["07-26 18:00"]);
  check(
    "and the stale one is not published",
    selectSlot(due, now, 120).action,
    "skip",
  );
}

console.log("\n6) First run ever (lastExecutedAt = null)");
{
  const now = jst("2026-07-27T12:30:00");
  const due = findDueSlots(["12:00"], now, null);
  check("today's 12:00 is the newest due slot", fmt(due).slice(-1), [
    "07-27 12:00",
  ]);
}

console.log("\n7) Malformed slot strings are ignored, not crashing");
{
  const now = jst("2026-07-27T12:30:00");
  const due = findDueSlots(
    ["", "99:99", "abc", "12:00"],
    now,
    jst("2026-07-27T06:00:00"),
  );
  check("only the valid slot survives", fmt(due), ["07-27 12:00"]);
}

console.log("\n8) findNextSlot for the UI preview");
{
  const now = jst("2026-07-27T13:00:00");
  check(
    "next slot later today",
    findNextSlot(["07:00", "18:00"], now)?.setZone(TZ).toFormat("MM-dd HH:mm"),
    "07-27 18:00",
  );
  check(
    "wraps to tomorrow when all slots have passed",
    findNextSlot(["07:00"], now)?.setZone(TZ).toFormat("MM-dd HH:mm"),
    "07-28 07:00",
  );
  check("no schedule returns null", findNextSlot([], now), null);
}

console.log("\n9) Grace window - catch up recent, drop stale");
{
  const now = jst("2026-07-27T11:15:00");

  // Missed by 70 minutes (late cron): still published.
  const recent = findDueSlots(["10:05"], now, jst("2026-07-27T09:00:00"));
  const d1 = selectSlot(recent, now, 120);
  check("70min-late slot is published", d1.action, "publish");
  check(
    "  and it targets the right slot",
    d1.action === "publish"
      ? d1.slot.setZone(TZ).toFormat("MM-dd HH:mm")
      : null,
    "07-27 10:05",
  );

  // Missed by 5 hours: dropped, not posted at the wrong time of day.
  const stale = findDueSlots(["06:00"], now, jst("2026-07-27T05:00:00"));
  check("5h-late slot is skipped", selectSlot(stale, now, 120).action, "skip");
}

console.log("\n10) Backlog collapses to one post, not a burst");
{
  const now = jst("2026-07-27T13:00:00");
  const due = findDueSlots(
    ["11:00", "12:00", "12:30"],
    now,
    jst("2026-07-27T10:00:00"),
  );
  check("three slots pending", due.length, 3);
  const decision = selectSlot(due, now, 120);
  check(
    "publishes only the most recent",
    decision.action === "publish"
      ? decision.slot.setZone(TZ).toFormat("MM-dd HH:mm")
      : null,
    "07-27 12:30",
  );
}

console.log("\n11) Nothing due");
{
  const now = jst("2026-07-27T13:00:00");
  check("empty due list", selectSlot([], now, 120).action, "none");
}

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
