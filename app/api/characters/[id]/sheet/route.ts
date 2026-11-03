import { NextResponse } from "next/server";
import { submitSheet } from "../../../../../lib/creator-comfy";

export const runtime = "nodejs";

/** The simple sheet from the chosen body and head: { seed?, name?, picks? }. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { seed?: unknown; name?: unknown; picks?: unknown };
  try {
    const job = await submitSheet(id, {
      seed: Number.isInteger(body.seed) ? Number(body.seed) : undefined,
      name: typeof body.name === "string" ? body.name : undefined, picks: body.picks as never,
    });
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send the sheet to ComfyUI." }, { status: 502 });
  }
}
