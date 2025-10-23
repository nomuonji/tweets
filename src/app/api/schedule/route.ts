import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { DraftDoc, PostDoc, AccountDoc } from "@/lib/types";
import { DateTime } from "luxon";

export async function GET() {
  try {
    const twentyFourHoursAgo = DateTime.now().minus({ hours: 24 }).toISO();
    if (!twentyFourHoursAgo) {
      throw new Error("Could not calculate the time 24 hours ago.");
    }

    const [draftsSnap, postsSnap, accountsSnap] = await Promise.all([
      adminDb
        .collection("drafts")
        .where('status', '==', 'scheduled')
        .orderBy("created_at", "asc")
        .get(),
      adminDb
        .collection("posts")
        .where("created_at", ">=", twentyFourHoursAgo)
        .orderBy("created_at", "desc")
        .get(),
      adminDb.collection("accounts").get(),
    ]);

    const allDrafts = draftsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DraftDoc[];
    const recentPosts = postsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PostDoc[];
    const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AccountDoc[];

    const projectedSchedule: DraftDoc[] = [];
    const now = DateTime.local();

    const draftsByAccount = allDrafts.reduce((acc, draft) => {
      const accountId = draft.target_account_id;
      if (accountId) {
        if (!acc[accountId]) {
          acc[accountId] = [];
        }
        acc[accountId].push(draft);
      }
      return acc;
    }, {} as Record<string, DraftDoc[]>);

    for (const account of accounts) {
      const accountDrafts = draftsByAccount[account.id];
      if (!accountDrafts || accountDrafts.length === 0 || !account.postSchedule || account.postSchedule.length === 0) {
        continue;
      }

      let draftIndex = 0;
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (const slot of account.postSchedule) {
          const [hour, minute] = slot.split(':').map(Number);
          const slotTime = now.plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 });

          if (slotTime > now) {
            if (draftIndex < accountDrafts.length) {
              const draftToSchedule = accountDrafts[draftIndex];
              projectedSchedule.push({
                ...draftToSchedule,
                schedule_time: slotTime.toISO(),
              });
              draftIndex++;
            } else {
              break;
            }
          }
        }
        if (draftIndex >= accountDrafts.length) {
          break;
        }
      }
    }

    projectedSchedule.sort((a, b) => {
        const timeA = a.schedule_time ? DateTime.fromISO(a.schedule_time).toMillis() : 0;
        const timeB = b.schedule_time ? DateTime.fromISO(b.schedule_time).toMillis() : 0;
        return timeA - timeB;
    });

    return NextResponse.json({ ok: true, scheduledDrafts: projectedSchedule, recentPosts, accounts });

  } catch (error) {
    console.error("Failed to fetch schedule data:", error);
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}