import { NextResponse } from "next/server";
import { describeCharacter } from "../../../lib/describe";
import { readImage } from "../../../lib/uploads";

export const runtime = "nodejs";

/** The character picture in, what it looks like out: the words the app puts in its description field. */
export async function POST(request: Request) {
  let picture: File;
  try {
    picture = readImage((await request.formData()).get("character"), "a character image");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Choose a character image." }, { status: 400 });
  }
  try {
    return NextResponse.json({ description: await describeCharacter(picture) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to describe the character." }, { status: 502 });
  }
}
