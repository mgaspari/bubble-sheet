// Zero-dependency static server for the demo: `npm run demo`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 5173);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
};

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
  if (path === "/") {
    // Redirect rather than serve, so the demo's relative URLs resolve.
    response.writeHead(302, { location: "/demo/index.html" }).end();
    return;
  }
  const file = join(root, normalize(path));
  if (!file.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`demo → http://localhost:${port}/`));
