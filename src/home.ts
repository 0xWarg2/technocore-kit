/**
 * The identity home: default file locations and one-step first-run setup.
 *
 * Every MCP client configures a server by writing a plain-text file by hand —
 * Claude Code, Codex, Cursor and Claude Desktop all do — so every value that
 * configuration has to carry is another thing to get wrong, and a passphrase
 * carried there is a secret sitting in a file that syncs. Defaulting both the
 * identity and its passphrase to one fixed directory reduces a working config
 * to the command name alone: no paths, no secrets, nothing to fill in.
 *
 * `TECHNOCORE_HOME` relocates the directory. A layout that is not a single
 * directory is what `technocore init --key` is for.
 */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  createIdentityFile,
  didFromPrivateKey,
  loadIdentity,
} from "./identity.ts";
import { IdentityError } from "./protocol.ts";

/** Entropy in a generated passphrase: 32 bytes, rendered as 43 base64url chars. */
const GENERATED_PASSPHRASE_BYTES = 32;

/** Root of the identity home. */
export function technocoreHome(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env["TECHNOCORE_HOME"];
  if (override !== undefined && override !== "") return resolve(override);
  return join(homedir(), ".technocore");
}

/** Default encrypted identity path inside the home. */
export function defaultIdentityPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(technocoreHome(env), "identity.pem");
}

/** Default passphrase file path inside the home. */
export function defaultPassphrasePath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(technocoreHome(env), "passphrase");
}

function readPassphraseFile(path: string, label: string): string {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (cause) {
    throw new IdentityError(
      `cannot read ${label} ${resolve(path)}: ${(cause as Error).message}`,
    );
  }
  // One trailing newline is stripped, so `printf` and an editor that appends
  // one behave alike; nothing else is trimmed, since a passphrase may
  // legitimately end in a space.
  const passphrase = contents.replace(/\r?\n$/, "");
  if (passphrase === "") {
    throw new IdentityError(`${label} ${resolve(path)} is empty`);
  }
  return passphrase;
}

function requirePrivateMode(path: string): void {
  // POSIX mode bits carry no meaning on Windows, where Node synthesises them.
  if (process.platform === "win32") return;
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new IdentityError(
      `${path} is readable by other users (mode ${mode.toString(8)}); ` +
        `run: chmod 600 ${path}`,
    );
  }
}

/**
 * Find the identity passphrase without prompting, in precedence order:
 * `TECHNOCORE_PASSPHRASE`, `TECHNOCORE_PASSPHRASE_FILE`, then the passphrase
 * file in the identity home if one exists.
 *
 * The implicit home file must not be readable by group or other. That check is
 * deliberately skipped for an explicitly configured path: aiming
 * `TECHNOCORE_PASSPHRASE_FILE` somewhere is a decision, while picking up a file
 * nobody named is not, and a world-readable secret used silently is worse than
 * one that refuses to load.
 */
export function findPassphrase(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const direct = env["TECHNOCORE_PASSPHRASE"];
  if (direct !== undefined && direct !== "") return direct;

  const configured = env["TECHNOCORE_PASSPHRASE_FILE"];
  if (configured !== undefined && configured !== "") {
    return readPassphraseFile(configured, "TECHNOCORE_PASSPHRASE_FILE");
  }

  const fallback = defaultPassphrasePath(env);
  if (!existsSync(fallback)) return undefined;
  requirePrivateMode(fallback);
  return readPassphraseFile(fallback, "passphrase file");
}

/**
 * Resolve the identity path for an interactive command: an explicit choice
 * first, then an `identity.pem` in the working directory — the layout the
 * reference Python starter uses, worth keeping for anyone standing in such a
 * directory on purpose — and otherwise the identity home.
 *
 * A background MCP server does not get the working-directory step: it is
 * spawned in whatever directory its client happens to use, so a stray
 * `identity.pem` there would silently change which DID signs.
 */
export function resolveIdentityPath(
  explicit: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  const configured = env["TECHNOCORE_IDENTITY"];
  if (configured !== undefined && configured !== "") return configured;
  if (existsSync("identity.pem")) return "identity.pem";
  return defaultIdentityPath(env);
}

export interface SetupResult {
  did: string;
  identityPath: string;
  passphrasePath: string;
  /** False when a usable identity already existed and nothing was written. */
  created: boolean;
}

/**
 * Make the identity home usable in one step, and never destructively.
 *
 * An existing identity is reported, not replaced, so re-running this is safe:
 * losing the key means losing the DID that already-published work is signed
 * with. The generated passphrase is 256 bits stored beside the key, which keeps
 * a leaked `identity.pem` on its own useless — the realistic accident is a
 * stray commit, a partial backup, or a synced folder — while being honest that
 * whatever can read the whole home directory holds both halves.
 */
export function setupIdentity(
  env: Record<string, string | undefined> = process.env,
): SetupResult {
  const home = technocoreHome(env);
  const identityPath = defaultIdentityPath(env);
  const passphrasePath = defaultPassphrasePath(env);
  mkdirSync(home, { recursive: true, mode: 0o700 });

  if (existsSync(identityPath)) {
    const passphrase = findPassphrase(env);
    if (passphrase === undefined) {
      throw new IdentityError(
        `${identityPath} already exists but its passphrase was not found; ` +
          `set TECHNOCORE_PASSPHRASE or write the passphrase to ${passphrasePath}`,
      );
    }
    return {
      did: didFromPrivateKey(loadIdentity(identityPath, passphrase)),
      identityPath,
      passphrasePath,
      created: false,
    };
  }

  const generated = randomBytes(GENERATED_PASSPHRASE_BYTES).toString("base64url");
  let passphrase: string;
  try {
    writeFileSync(passphrasePath, `${generated}\n`, { flag: "wx", mode: 0o600 });
    passphrase = generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new IdentityError(
        `cannot write ${passphrasePath}: ${String(error)}`,
      );
    }
    // A passphrase file with no key is a half-finished setup. Reuse it rather
    // than overwrite a secret that may unlock a key kept somewhere else.
    requirePrivateMode(passphrasePath);
    passphrase = readPassphraseFile(passphrasePath, "passphrase file");
  }
  return {
    did: createIdentityFile(identityPath, passphrase),
    identityPath,
    passphrasePath,
    created: true,
  };
}
