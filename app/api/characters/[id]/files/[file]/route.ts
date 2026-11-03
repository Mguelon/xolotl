import { readFile } from "node:fs/promises";
import { FILE_TYPES, characterFile } from "../../../../../../lib/characters";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  try {
    const bytes = await readFile(characterFile(id, file));
    const type = FILE_TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream";
    return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}
