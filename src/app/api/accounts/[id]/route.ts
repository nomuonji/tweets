import { NextResponse } from "next/server";
import { z } from "zod";
import { updateAccount } from "@/lib/services/account-service";

const payloadSchema = z.object({
  concept: z.string().optional(),
  autoPostEnabled: z.boolean().optional(),
  postSchedule: z.array(z.string()).optional(),
  selectedTipIds: z.array(z.string()).optional(),
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
