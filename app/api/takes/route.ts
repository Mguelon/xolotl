import { NextResponse } from "next/server";
import { listTakes } from "../../../lib/takes";
import { getJob, isActive } from "../../../lib/comfy";

export const runtime = "nodejs";

export async function GET() {
  // Takes still in flight get their status from the proxy first, so a reload (or another client) sees the truth.
  const stale = (await listTakes()).filter((take) => isActive(take.status) && take.status !== "canceled");
  await Promise.all(stale.map((take) => getJob(take.id).catch(() => null)));
  return NextResponse.json({ takes: await listTakes() }, { headers: { "Cache-Control": "no-store" } });
}
