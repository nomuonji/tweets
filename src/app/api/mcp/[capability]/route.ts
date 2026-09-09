import { handleMcpRequest } from "@/lib/mcp/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { capability: string } }) { return handleMcpRequest(request, params.capability); }
export async function GET(request: Request, { params }: { params: { capability: string } }) { return handleMcpRequest(request, params.capability); }
export async function DELETE(request: Request, { params }: { params: { capability: string } }) { return handleMcpRequest(request, params.capability); }
