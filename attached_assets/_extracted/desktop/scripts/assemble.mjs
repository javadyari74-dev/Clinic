import { execSync } from "node:child_process";
import { rm, cp, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..");

const distDir = path.join(desktopDir, "dist");
const serverOut = path.join(distDir, "server");
const publicOut = path.join(distDir, "public");

const beautyDist = path.join(repoRoot, "artifacts", "beauty-clinic", "dist", "public");
const serverDist = path.join(repoRoot, "artifacts", "api-server", "dist");

function run(cmd, extraEnv = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // ---------------------------------------------------------------------------
  // Pre-built mode.
  //
  // The web frontend and the server are plain JavaScript / static files, so we
  // build them once on Linux (where the workspace pnpm/esbuild config works) and
  // ship the result inside desktop/dist. On a Windows machine those JS bundles
  // run as-is, so we MUST NOT try to rebuild them there: the workspace
  // pnpm-workspace.yaml strips all non-Linux esbuild/lightningcss binaries,
  // which makes `pnpm build` fail on Windows.
  //
  // If desktop/dist is already assembled, skip everything and let
  // electron-builder package it directly.
  // ---------------------------------------------------------------------------
  const prebuiltServer = path.join(serverOut, "index.mjs");
  const prebuiltPublic = path.join(publicOut, "index.html");
  if ((await exists(prebuiltServer)) && (await exists(prebuiltPublic))) {
    console.log(
      "\n✓ Using pre-built bundle in desktop/dist (skipping the workspace build).",
    );
    console.log("  - server  ->", serverOut);
    console.log("  - public  ->", publicOut);
    return;
  }

  if (process.platform !== "win32") {
    console.warn(
      "\n[warning] You are not on Windows. The native SQLite binary bundled here\n" +
        "          will match THIS platform, not Windows. To produce a working\n" +
        "          Windows installer (.exe), run this build on a Windows machine.\n",
    );
  }

  // 1. Build the frontend for single-origin serving (base path "/").
  run("pnpm --filter @workspace/beauty-clinic run build", {
    BASE_PATH: "/",
    PORT: "5173",
    NODE_ENV: "production",
  });

  // 2. Build the backend server bundle.
  run("pnpm --filter @workspace/api-server run build", {
    NODE_ENV: "production",
  });

  // 3. Assemble into desktop/dist.
  console.log("\n> assembling desktop/dist ...");
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  if (!(await exists(beautyDist))) {
    throw new Error(`Frontend build output not found at ${beautyDist}`);
  }
  if (!(await exists(serverDist))) {
    throw new Error(`Server build output not found at ${serverDist}`);
  }

  await cp(beautyDist, publicOut, { recursive: true });
  await cp(serverDist, serverOut, { recursive: true });

  console.log("\n✓ Assembled:");
  console.log(`  - server  -> ${serverOut}`);
  console.log(`  - public  -> ${publicOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
