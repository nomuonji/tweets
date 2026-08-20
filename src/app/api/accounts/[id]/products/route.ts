import { NextResponse } from "next/server";
import { z } from "zod";
import { DateTime } from "luxon";
import {
  createProduct,
  deleteProduct,
  getProductsForAccount,
  updateProduct,
} from "@/lib/services/product-service";

const productSchema = z.object({
  asin: z.string().trim().min(3).max(32),
  title: z.string().trim().min(1).max(300),
  url: z.string().trim().url().max(1000).optional().or(z.literal("")),
  price: z.string().trim().max(50).optional().or(z.literal("")),
  image_url: z.string().trim().url().max(1000).optional().or(z.literal("")),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  promo_hook: z.string().trim().max(500).optional().or(z.literal("")),
  enabled: z.boolean().optional(),
});

type ProductPayload = z.infer<typeof productSchema>;

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const products = await getProductsForAccount(params.id);
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const json = await request.json();
    const parsed = productSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: "入力内容が不正です。", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const data = parsed.data as ProductPayload;
    const now = DateTime.utc().toISO();
    const product = await createProduct(params.id, {
      asin: data.asin,
      title: data.title,
      ...(data.url ? { url: data.url } : {}),
      ...(data.price ? { price: data.price } : {}),
      ...(data.image_url ? { image_url: data.image_url } : {}),
      ...(data.category ? { category: data.category } : {}),
      ...(data.description ? { description: data.description } : {}),
      ...(data.promo_hook ? { promo_hook: data.promo_hook } : {}),
      enabled: data.enabled ?? true,
      times_used: 0,
      created_at: now,
      updated_at: now,
    });
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get("id");
    if (!productId) {
      return NextResponse.json(
        { ok: false, message: "id は必須です。" },
        { status: 400 },
      );
    }
    const json = await request.json();
    const parsed = productSchema.partial().safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: "入力内容が不正です。", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const data = parsed.data as Partial<ProductPayload>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && value === "") continue;
      patch[key] = value;
    }
    const product = await updateProduct(params.id, productId, patch);
    if (!product) {
      return NextResponse.json(
        { ok: false, message: "商品が見つかりません。" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get("id");
    if (!productId) {
      return NextResponse.json(
        { ok: false, message: "id は必須です。" },
        { status: 400 },
      );
    }
    const deleted = await deleteProduct(params.id, productId);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, message: "商品が見つかりません。" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}