import fs from "node:fs";

const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;

/**
 * Lists the slide images in a directory in natural order (slide-2 before slide-10).
 * Re-reads only when the directory's mtime changes, so slides can be added while the server runs.
 */
export function slideLister(dir: string): () => string[] {
  let seen = -1;
  let cached: string[] = [];
  return () => {
    let mtime: number;
    try { mtime = fs.statSync(dir).mtimeMs; } catch { seen = -1; return (cached = []); }
    if (mtime !== seen) {
      seen = mtime;
      cached = fs.readdirSync(dir).filter((f) => IMAGE.test(f) && !f.startsWith("."))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    }
    return cached;
  };
}
