import { NextResponse } from "next/server";
import { readCharacterJob } from "../../../../../../lib/creator-comfy";

export const runtime = "nodejs";

/** Where a job is; once it is done, the character with the job's pictures among its versions. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; job: string }> }) {
  const { id, job } = await params;
  try {
    return NextResponse.json(await readCharacterJob(id, job));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the job." }, { status: 502 });
  }
}
