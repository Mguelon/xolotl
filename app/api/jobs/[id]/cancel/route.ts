import { NextResponse } from "next/server";
import { cancelJob } from "../../../../../lib/comfy";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await cancelJob(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to stop the take." }, { status: 502 });
  }
}
