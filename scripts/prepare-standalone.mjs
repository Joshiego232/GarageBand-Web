#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const desktopDir = path.join(root, "desktop");

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(standalone, "server.js")))) {
  throw new Error(
    "Next.js standalone server was not generated. Check next.config.ts for output: \"standalone\"."
  );
}

const staticDir = path.join(root, ".next", "static");
if (!(await exists(staticDir))) {
  throw new Error("Next.js static assets are missing. Run next build before preparing the desktop bundle.");
}

await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(staticDir, path.join(standalone, ".next", "static"), {
  recursive: true,
  force: true,
});

const publicDir = path.join(root, "public");
if (await exists(publicDir)) {
  await cp(publicDir, path.join(standalone, "public"), {
    recursive: true,
    force: true,
  });
}

const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
await mkdir(desktopDir, { recursive: true });
const desktopPackagePath = path.join(desktopDir, "package.json");
let desktopPackage = {
  name: "garageband-web-studio-desktop",
  private: true,
  productName: "GarageBand Web Studio",
  description: "Local desktop edition of GarageBand Web Studio",
  main: "main.cjs",
  author: "Joshiego232",
};
if (await exists(desktopPackagePath)) {
  desktopPackage = JSON.parse(await readFile(desktopPackagePath, "utf8"));
}
desktopPackage.version = rootPackage.version;
await writeFile(desktopPackagePath, JSON.stringify(desktopPackage, null, 2) + "\n");

const desktopStandalone = path.join(desktopDir, "standalone");
await rm(desktopStandalone, { recursive: true, force: true });
await cp(standalone, desktopStandalone, { recursive: true });
console.log("Prepared Electron app bundle at " + desktopStandalone);
