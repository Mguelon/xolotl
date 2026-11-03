import { NextResponse } from "next/server";
import { submitHeads } from "../../../../../lib/creator-comfy";

export const runtime = "nodejs";

/** A round of heads: { prompt, count (1-4), seed?, picks? }. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { prompt?: unknown; count?: unknown; seed?: unknown; picks?: unknown };
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return NextResponse.json({ error: "Say what the head looks like." }, { status: 400 });
  try {
    const job = await submitHeads(id, {
      prompt: body.prompt.slice(0, 4000), count: Number(body.count) || 4,
      seed: Number.isInteger(body.seed) ? Number(body.seed) : undefined, picks: body.picks as never,
    });
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send the heads to ComfyUI." }, { status: 502 });
  }
}
