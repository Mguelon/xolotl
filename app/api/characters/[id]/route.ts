import { NextResponse } from "next/server";
import { deleteCharacter, readCharacter, updateCharacter } from "../../../../lib/characters";
import { STEPS, type Step } from "../../../../lib/character";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await readCharacter(id).catch(() => null);
  return meta ? NextResponse.json(meta) : NextResponse.json({ error: "No such character." }, { status: 404 });
}

/** The name, the buttons' picks and which version of each step is the chosen one. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { name?: unknown; picks?: unknown; chosen?: Partial<Record<Step, unknown>> };
  try {
    return NextResponse.json(await updateCharacter(id, (meta) => {
      if (typeof body.name === "string") meta.name = body.name.trim().slice(0, 60);
      if (body.picks && typeof body.picks === "object") meta.picks = { ...meta.picks, ...(body.picks as typeof meta.picks) };
      for (const step of STEPS) {
        const want = body.chosen?.[step];
        if (typeof want === "string" && meta.versions[step].some((v) => v.id === want)) meta.chosen[step] = want;
      }
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save." }, { status: 404 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteCharacter(id);
  return NextResponse.json({ deleted: id });
}
