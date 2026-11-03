import { NextResponse } from "next/server";
import { submitEdit } from "../../../../../lib/creator-comfy";

export const runtime = "nodejs";

/** The body around a head ({ kind: "body", from: head version }) or a change to a picture ({ kind: "edit", step, from }). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { kind?: unknown; step?: unknown; from?: unknown; prompt?: unknown; seed?: unknown; picks?: unknown };
  const kind = body.kind === "body" ? "body" : body.kind === "edit" ? "edit" : null;
  const step = kind === "body" ? "body" : body.step === "head" || body.step === "body" ? body.step : null;
  if (!kind || !step || typeof body.from !== "string" || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "Say which picture to work from and what to do with it." }, { status: 400 });
  }
  try {
    const job = await submitEdit(id, {
      kind, step, from: body.from, prompt: body.prompt.slice(0, 4000),
      seed: Number.isInteger(body.seed) ? Number(body.seed) : undefined, picks: body.picks as never,
    });
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send the change to ComfyUI." }, { status: 502 });
  }
}
