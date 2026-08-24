#!/usr/bin/env node
/**
 * Build src/ → dist/ when a TypeScript toolchain is present, and skip quietly
 * when it is not.
 *
 * npm runs this hook in a temporary clone when the package is installed from a
 * git URL. Under `npm install -g <git-url>` that clone's inner install resolves
 * globally, so devDependencies — and therefore tsc — never land in it. dist/ is
 * committed for exactly that case: a missing toolchain must skip the build
 * instead of failing the install with `sh: tsc: command not found`.
 *
 * The hook still has to exist: without any prepare/prepack script npm treats a
 * git dependency as a directory to link rather than a package to pack, and the
 * global install ends up as a symlink into npm's cache tmp dir that is deleted
 * as soon as the install finishes.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tsc)) {
  process.stdout.write("prepare: no local typescript; using the committed dist/\n");
  process.exit(0);
}

const { status } = spawnSync(process.execPath, [tsc], { cwd: root, stdio: "inherit" });
process.exit(status ?? 1);
