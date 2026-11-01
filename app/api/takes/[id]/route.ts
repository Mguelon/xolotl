import { NextResponse } from "next/server";
import { deleteTake, readTake } from "../../../../lib/takes";
import { isActive } from "../../../../lib/comfy";

export const runtime = "nodejs";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const take = await readTake(id);
  if (!take) return NextResponse.json({ error: "No such take." }, { status: 404 });
  if (isActive(take.status) && take.status !== "canceled") return NextResponse.json({ error: "Stop the take before deleting it." }, { status: 409 });
  await deleteTake(id);
  return new NextResponse(null, { status: 204 });
}
