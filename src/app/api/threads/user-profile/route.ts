import { NextResponse } from "next/server";
import { getThreadsUserProfile } from "@/lib/platforms/threads";

export async function POST(request: Request) {
  try {
    const { accessToken } = (await request.json()) as { accessToken?: string };
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, message: "Access token is required." },
        { status: 400 },
      );
    }

    const profile = await getThreadsUserProfile(accessToken);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
