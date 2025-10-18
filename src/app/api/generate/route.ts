import { NextResponse } from "next/server";
import { getPostById, getSettings } from "@/lib/services/firestore.server";
import { generateDrafts } from "@/lib/services/generation-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const basePostId = body.basePostId as string;
    const targetPlatform = body.platform as "x" | "threads";
    const createdBy = body.createdBy ?? "system";

    if (!basePostId || !targetPlatform) {
      return NextResponse.json(
        { ok: false, message: "basePostId and platform are required" },
        { status: 400 },
      );
    }

    const [settings, basePost] = await Promise.all([
      getSettings(),
      getPostById(basePostId),
    ]);

    if (!settings) {
      return NextResponse.json(
        { ok: false, message: "Settings not found" },
        { status: 400 },
      );
    }

    if (!basePost) {
      return NextResponse.json(
        { ok: false, message: "Base post not found" },
        { status: 404 },
      );
    }

    const drafts = await generateDrafts({
      basePost,
      settings: settings.generation,
      createdBy,
      targetPlatform,
    });

    return NextResponse.json({ ok: true, drafts });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
