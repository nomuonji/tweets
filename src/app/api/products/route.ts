import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createProductPoolItem,
  deleteProductPoolItem,
  getProductPool,
  syncProductAssignments,
  updateProductPoolItem,
} from "@/lib/services/product-pool-service";

const productPoolSchema = z.object({
  asin: z.string().trim().min(3).max(32),
  title: z.string().trim().min(1).max(300),
  url: z.string().trim().url().max(1000).optional().or(z.literal("")),
  price: z.string().trim().max(50).optional().or(z.literal("")),
  image_url: z.string().trim().url().max(1000).optional().or(z.literal("")),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  theme: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.string().trim().max(50).optional().or(z.literal("")),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  promo_hook: z.string().trim().max(500).optional().or(z.literal("")),
  score: z.coerce.number().min(0).max(25).optional(),
  status: z.enum(["candidate", "approved", "archived"]).optional(),
  account_ids: z.array(z.string().min(1)).optional(),
  source_url: z.string().trim().url().max(1000).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

function omitEmpty<T extends Record<string, unknown>>(data: T) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== "" && value !== undefined),
  ) as Partial<T>;
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, products: await getProductPool() });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = productPoolSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "入力内容が不正です。" }, { status: 400 });
    }
    const { account_ids, ...catalogInput } = parsed.data;
    const data = omitEmpty(catalogInput as Record<string, unknown>);
    const product = await createProductPoolItem({
      asin: data.asin as string,
      title: data.title as string,
      ...(data as Omit<typeof data, "asin" | "title">),
      status: (data.status as "candidate" | "approved" | "archived" | undefined) ?? "candidate",
    });
    if (account_ids) await syncProductAssignments(product.asin, account_ids);
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "id は必須です。" }, { status: 400 });
    const parsed = productPoolSchema.partial().safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ ok: false, message: "入力内容が不正です。" }, { status: 400 });
    const { account_ids, ...catalogInput } = parsed.data;
    const product = await updateProductPoolItem(id, omitEmpty(catalogInput as Record<string, unknown>));
    if (!product) return NextResponse.json({ ok: false, message: "商品が見つかりません。" }, { status: 404 });
    if (account_ids) await syncProductAssignments(product.asin, account_ids);
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "id は必須です。" }, { status: 400 });
    const deleted = await deleteProductPoolItem(id);
    if (!deleted) return NextResponse.json({ ok: false, message: "商品が見つかりません。" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}
