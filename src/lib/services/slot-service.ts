import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { DraftDoc, Platform, SettingsDoc } from "@/lib/types";

const DAY_OFFSETS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  nextweek: 7,
};

const DAY_PART_HOURS: Record<string, number> = {
  am: 9,
  noon: 13,
  night: 20,
};

export function slotToIso(slotKey: string, timezone: string) {
  const [day, part] = slotKey.split("_");
  const offset = DAY_OFFSETS[day] ?? 0;
  const hour = DAY_PART_HOURS[part] ?? 9;

  const iso = DateTime.now()
    .setZone(timezone)
    .startOf("day")
    .plus({ days: offset })
    .set({ hour, minute: 0, second: 0, millisecond: 0 })
    .toUTC()
    .toISO();

  if (!iso) {
    throw new Error(`Unable to compute ISO time for slot ${slotKey}`);
  }

  return iso;
}

export async function getReservedSlots(platform: Platform) {
  const snapshot = await adminDb
    .collection("drafts")
    .where("target_platform", "==", platform)
    .where("status", "==", "scheduled")
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as DraftDoc)
    .reduce<Record<string, string>>((acc, draft) => {
      if (draft.schedule_time) {
        acc[draft.schedule_time] = draft.id;
      }
      return acc;
    }, {});
}

export function getPlatformSlotOptions(
  settings: SettingsDoc,
  platform: Platform,
  reserved: Record<string, string>,
) {
  const timezone = settings.timezone ?? process.env.TIMEZONE ?? "Asia/Tokyo";
  const keys = settings.slots[platform] ?? [];

  return keys.map((key) => {
    const iso = slotToIso(key, timezone);
    return {
      key,
      label: key.replace("_", " ").toUpperCase(),
      iso,
      reservedBy: reserved[iso],
    };
  });
}
