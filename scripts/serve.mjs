// Zero-dependency dev server for the demo: `npm start`.
//
// Builds first when dist/ is missing or older than src/, so a fresh clone
// serves a working page instead of a blank one.
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 5173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
};

if (await isStale()) {
  if (!(await exists(join(root, "node_modules", "typescript")))) {
    console.error("Dependencies are missing. Run:\n\n  npm install && npm start\n");
    process.exit(1);
  }
  console.log("Building…");
  const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: false });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

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
}).listen(port, () => console.log(`\n  Demo ready → http://localhost:${port}/\n`));

/** True when dist/ is absent or any source file is newer than what was built. */
async function isStale() {
  const built = await modified(join(root, "dist"));
  if (built === 0) return true;
  return (await modified(join(root, "src"))) > built;
}

async function modified(dir) {
  let newest = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const at = entry.isDirectory() ? await modified(path) : (await stat(path)).mtimeMs;
      newest = Math.max(newest, at);
    }
  } catch {
    return 0;
  }
  return newest;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
