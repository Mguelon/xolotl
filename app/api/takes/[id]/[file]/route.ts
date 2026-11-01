import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { TAKE_FILES, takeFile } from "../../../../../lib/takes";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  const type = TAKE_FILES[file];
  if (!type) return Response.json({ error: "Not a take file." }, { status: 404 });
  let path: string;
  let size: number;
  try { path = takeFile(id, file); size = (await stat(path)).size; } catch { return Response.json({ error: "Not found." }, { status: 404 }); }
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  if (file === "workflow.json") headers["Content-Disposition"] = `attachment; filename="xolotl-${id.slice(0, 8)}.workflow.json"`;
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
}
