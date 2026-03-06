import { adminDb } from "@/lib/firebase/admin";
import { DateTime } from "luxon";
import fs from 'fs';
import 'dotenv/config';

interface DraftInput {
    accountId: string;
    platform: string;
    text: string;
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Please provide the JSON file path as argument.");
        process.exit(1);
    }
    const jsonStr = fs.readFileSync(filePath, 'utf-8');
    const drafts: DraftInput[] = JSON.parse(jsonStr);

    let savedCount = 0;
    for (const d of drafts) {
        const now = DateTime.utc().toISO()!;
        const draftId = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

        await adminDb.collection("drafts").doc(draftId).set({
            id: draftId,
            target_platform: d.platform,
            target_account_id: d.accountId,
            text: d.text,
            hashtags: [],
            status: "scheduled",
            schedule_time: null,
            published_at: null,
            created_by: "agent-skill",
            created_at: now,
            updated_at: now,
            similarity_warning: false
        });
        console.log(`Saved draft for ${d.accountId}: ${d.text.substring(0, 30)}...`);
        savedCount++;
    }
    console.log(`Successfully saved ${savedCount} drafts.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
