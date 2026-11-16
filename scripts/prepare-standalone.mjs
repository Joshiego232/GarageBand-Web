#!/usr/bin/env node
import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  throw new Error("Next.js standalone server was not generated. Run next build before preparing the desktop bundle.");
}

await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
  force: true,
});
await cp(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
  force: true,
});

await mkdir(path.join(standalone, "prisma"), { recursive: true });
await copyFile(
  path.join(root, "prisma", "schema.prisma"),
  path.join(standalone, "prisma", "schema.prisma"),
);

const databaseCandidates = [
  path.join(root, "prisma", "dev.db"),
  path.join(root, "dev.db"),
];
let copiedDatabase = false;
for (const candidate of databaseCandidates) {
  if (await exists(candidate)) {
    await copyFile(candidate, path.join(standalone, "dev.db"));
    copiedDatabase = true;
    break;
  }
}
if (!copiedDatabase) {
  console.warn("No local SQLite template was found. Run npm run db:push before building desktop installers.");
}

const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const desktopPackagePath = path.join(desktopDir, "package.json");
const desktopPackage = JSON.parse(await readFile(desktopPackagePath, "utf8"));
desktopPackage.version = rootPackage.version;
await writeFile(desktopPackagePath, JSON.stringify(desktopPackage, null, 2) + "\n");

const desktopStandalone = path.join(desktopDir, "standalone");
await rm(desktopStandalone, { recursive: true, force: true });
await cp(standalone, desktopStandalone, { recursive: true });
console.log("Prepared Electron app bundle at " + desktopStandalone);
