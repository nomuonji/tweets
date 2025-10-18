import { NextResponse } from "next/server";
import { z } from "zod";
import { DateTime } from "luxon";
import { upsertAccount } from "@/lib/services/account-service";

const payloadSchema = z.object({
  platform: z.enum(["x", "threads"]),
  handle: z.string().min(1),
  displayName: z.string().optional(),
  oauthVersion: z.enum(["oauth2", "oauth1"]),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  consumerKey: z.string().optional(),
  consumerSecret: z.string().optional(),
  accessTokenSecret: z.string().optional(),
  rapidApiKey: z.string().optional(),
  rapidApiHost: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const data = payloadSchema.parse(json);

    if (data.oauthVersion === "oauth1") {
      if (!data.consumerKey || !data.consumerSecret || !data.accessTokenSecret) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "For OAuth 1.0a, provide Consumer Key, Consumer Secret, and Access Token Secret.",
          },
          { status: 400 },
        );
      }
    }

    const now = DateTime.utc().toISO();
    const expiresAtIso =
      data.oauthVersion === "oauth2" && data.expiresAt
        ? DateTime.fromISO(data.expiresAt).toUTC().toISO() ?? undefined
        : undefined;

    await upsertAccount({
      platform: data.platform,
      handle: data.handle,
      displayName: data.displayName ?? data.handle,
      scopes: data.oauthVersion === "oauth1" ? [] : data.scopes ?? [],
      token: {
        accessToken: data.accessToken,
        refreshToken:
          data.oauthVersion === "oauth2" ? data.refreshToken : undefined,
        expiresAt: expiresAtIso,
        consumerKey: data.oauthVersion === "oauth1" ? data.consumerKey : undefined,
        consumerSecret:
          data.oauthVersion === "oauth1" ? data.consumerSecret : undefined,
        accessTokenSecret:
          data.oauthVersion === "oauth1" ? data.accessTokenSecret : undefined,
        oauthVersion: data.oauthVersion,
        apiKey: data.rapidApiKey,
        apiHost: data.rapidApiHost,
      },
      extra: {
        created_at: now,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          message: "Payload validation failed.",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}