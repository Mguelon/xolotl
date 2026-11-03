import { NextResponse } from "next/server";
import { createCharacter, listCharacters } from "../../../lib/characters";

export const runtime = "nodejs";

/** Your characters, newest first, with what the roster shows: the name and the chosen head. */
export async function GET() {
  const all = await listCharacters();
  return NextResponse.json({
    characters: all.map((c) => {
      const head = c.versions.head.find((v) => v.id === c.chosen.head) ?? c.versions.head.at(-1) ?? null;
      return { id: c.id, name: c.name, updatedAt: c.updatedAt, head: head ? `/api/characters/${c.id}/files/${head.file}` : null };
    }),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { picks?: Record<string, unknown> };
  return NextResponse.json(await createCharacter((body.picks ?? {}) as never), { status: 201 });
}
