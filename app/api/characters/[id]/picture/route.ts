import { NextResponse } from "next/server";
import { addPicture } from "../../../../../lib/creator-comfy";
import { readImage } from "../../../../../lib/uploads";

export const runtime = "nodejs";

/** Your own picture of the character (form field "picture"), kept as the head's newest version. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let picture: File;
  let picks: unknown;
  try {
    const form = await request.formData();
    picture = readImage(form.get("picture"), "the picture of your character");
    const raw = form.get("picks");
    picks = typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Choose a picture." }, { status: 400 });
  }
  try {
    return NextResponse.json(await addPicture(id, picture, picks as never), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not keep the picture." }, { status: 404 });
  }
}
