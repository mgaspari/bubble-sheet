// tsc emits plain .js into dist/cjs. Rename those to .cjs — and copy the ESM
// declarations across as .d.cts — so the CommonJS build keeps working under the
// package's "type": "module".
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cjs = new URL("../dist/cjs/", import.meta.url).pathname;
const esm = new URL("../dist/esm/", import.meta.url).pathname;

for (const name of await readdir(cjs)) {
  if (!name.endsWith(".js")) continue;
  const path = join(cjs, name);
  const source = await readFile(path, "utf8");
  await writeFile(path, rewrite(source));
  await rename(path, path.replace(/\.js$/, ".cjs"));
}

for (const name of await readdir(esm)) {
  if (!name.endsWith(".d.ts")) continue;
  const source = await readFile(join(esm, name), "utf8");
  await writeFile(
    join(cjs, name.replace(/\.d\.ts$/, ".d.cts")),
    rewrite(source).replace(/^\/\/# sourceMappingURL=.*$/gm, ""),
  );
}

/** Point relative specifiers at their .cjs counterparts. */
function rewrite(source) {
  return source.replace(/(["'])\.\/([\w-]+)\.js\1/g, '$1./$2.cjs$1');
}
