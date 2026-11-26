import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const processorPath = path.join(
    process.cwd(),
    "node_modules",
    "spessasynth_lib",
    "dist",
    "spessasynth_processor.min.js",
  );
  const processor = await readFile(processorPath);
  return new Response(processor, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
