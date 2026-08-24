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
/** Root of the identity home. */
export declare function technocoreHome(env?: Record<string, string | undefined>): string;
/** Default encrypted identity path inside the home. */
export declare function defaultIdentityPath(env?: Record<string, string | undefined>): string;
/** Default passphrase file path inside the home. */
export declare function defaultPassphrasePath(env?: Record<string, string | undefined>): string;
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
export declare function findPassphrase(env?: Record<string, string | undefined>): string | undefined;
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
export declare function resolveIdentityPath(explicit: string | undefined, env?: Record<string, string | undefined>): string;
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
export declare function setupIdentity(env?: Record<string, string | undefined>): SetupResult;
