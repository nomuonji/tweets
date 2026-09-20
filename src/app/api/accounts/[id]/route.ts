import { NextResponse } from "next/server";
import { z } from "zod";
import { updateAccount } from "@/lib/services/account-service";

const payloadSchema = z.object({
  concept: z.string().optional(),
  autoPostEnabled: z.boolean().optional(),
  postSchedule: z.array(z.string()).optional(),
  selectedTipIds: z.array(z.string()).optional(),
  minPostLength: z.number().optional(),
  maxPostLength: z.number().optional(),
  r18Mode: z.boolean().optional(),
  discoveryKeywords: z.array(z.string().trim().min(1)).max(20).optional(),
  referenceAccountIds: z.array(z.string()).max(50).optional(),
  generationStrategy: z.literal("external").optional(),
  explorationRate: z.number().min(0).max(1).optional(),
  promoEnabled: z.boolean().optional(),
  promoRate: z.number().min(0).max(1).optional(),
  promoReplyRate: z.number().min(0).max(1).optional(),
  promoReplyDailyLimit: z.number().int().min(0).max(50).optional(),
  promoReplyMode: z.enum(["off", "amazon", "affiliate_offer", "mixed"]).optional(),
  monetizationThemes: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  affiliateThirdPartyEnabled: z.boolean().optional(),
  promoReplyEnabled: z.boolean().optional(),
  promoReplyMinScore: z.number().min(0).optional(),
  promoReplyMinImpressions: z.number().min(0).optional(),
  promoReplyLookbackDays: z.number().min(1).max(30).optional(),
  promoReplyCooldownMinutes: z.number().min(0).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const accountId = params.id;
    const json = await request.json();
    const data = payloadSchema.parse(json);

    await updateAccount(accountId, data);

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
