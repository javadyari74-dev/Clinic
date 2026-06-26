import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.resolve(dir, "seed-demo.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(dir, "seed-demo.mjs"),
  logLevel: "info",
  external: ["*.node", "libsql", "@libsql/client", "@libsql/linux-x64-gnu", "@libsql/linux-x64-musl"],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);`,
  },
});
