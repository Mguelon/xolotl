import { NextResponse } from "next/server";
import { listTakes } from "../../../lib/takes";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ takes: await listTakes() }, { headers: { "Cache-Control": "no-store" } });
}
