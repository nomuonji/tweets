import { NextResponse } from "next/server";
import { getRapidApiUsage } from "@/lib/services/firestore.server";

export async function GET() {
  try {
    const usage = await getRapidApiUsage();
    return NextResponse.json({ ok: true, usage });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
