// Local dev server: the static page plus the api/ routes, no dependencies.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const port = Number(process.env.PORT || 3100);
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const file = join(process.cwd(), "api", url.pathname.slice(5) + ".mjs");
    if (!existsSync(file)) { res.statusCode = 404; return res.end("no route"); }
    const mod = await import(file + "?t=" + Date.now());
    return mod.default(req, res);
  }
  const p = join(process.cwd(), "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(p)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream");
  res.end(readFileSync(p));
}).listen(port, () => console.log(`Talos on http://localhost:${port}`));
