#!/usr/bin/env node
/**
 * technocore — CLI for Technocore DIDs, signed messages, and proofs.
 *
 * Command-compatible with the reference Python starter:
 *   init | did | say <room> <text> | read <room> | proof <url> <commit> |
 *   verify-proof <file>
 *
 * `setup`, `announce` and `compose` are additions: a one-step first run, and
 * two text formatters that keep a hand-copied DID out of an announcement.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { announcedProof, postAnnouncement, roomAnnouncement, } from "./announce.js";
import { TechnocoreClient } from "./client.js";
import { findPassphrase, resolveIdentityPath, setupIdentity, technocoreHome, } from "./home.js";
import { createIdentityFile, didFromPrivateKey, loadIdentity, } from "./identity.js";
import { createContributionProof, verifyContributionProof, } from "./proof.js";
import { DEFAULT_BASE_URL, IdentityError, NetworkError, ProtocolError, } from "./protocol.js";
const USAGE = `usage: technocore <command> [options]

commands:
  setup                         one-step first run: identity, passphrase, DID
  init                          create one encrypted Ed25519 DID identity
  did                           print the public DID
  say <room> <text>             publish one signed room message
  read <room>                   read untrusted room data as JSON
  proof <artifact_url> <commit> sign a public contribution revision
  verify-proof <proof_file>     verify public proof JSON
  announce <room> <seq>         format the block announcing a published message
  compose <summary>             format one line to hand to say

options:
  --key <path>       identity PEM path (default: ~/.technocore/identity.pem)
  --base-url <url>   Technocore base URL (default: ${DEFAULT_BASE_URL})
  --timeout <secs>   HTTP timeout in seconds (default: 20)
  --nonce <digits>   say: advanced recovery override; 1-19 ASCII digits
  --since <n>        read: sequence cursor
  --limit <n>        read: max messages, 1-200 (default: 50)
  --wait <secs>      read: long-poll seconds (0-10); requires --since
  --follow           read: keep reading until interrupted
  --output <path>    proof: write proof JSON to a new file
  --artifact-url <u> announce, compose: HTTPS URL of the contribution
  --proof-file <p>   announce: proof JSON to quote; must be signed by this DID

environment:
  TECHNOCORE_HOME             identity directory (default: ~/.technocore)
  TECHNOCORE_IDENTITY         identity PEM path, same as --key
  TECHNOCORE_PASSPHRASE       identity passphrase (else prompted on a TTY)
  TECHNOCORE_PASSPHRASE_FILE  file to read the passphrase from instead
`;
class UsageError extends Error {
}
/** Read a proof document from disk as a plain object, or explain why not. */
function readProofObject(path) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(resolve(path), "utf-8"));
    }
    catch (error) {
        throw new ProtocolError(`cannot read proof JSON: ${String(error)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ProtocolError("proof JSON must contain an object");
    }
    return parsed;
}
async function promptHidden(question) {
    const muted = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
    const rl = createInterface({
        input: process.stdin,
        output: muted,
        terminal: true,
    });
    process.stderr.write(question);
    try {
        const answer = await rl.question("");
        process.stderr.write("\n");
        return answer;
    }
    finally {
        rl.close();
    }
}
async function resolvePassphrase(purpose, keyPath) {
    const found = findPassphrase();
    if (found !== undefined)
        return found;
    if (!process.stdin.isTTY) {
        throw new IdentityError("identity is encrypted and no passphrase was provided; set " +
            "TECHNOCORE_PASSPHRASE or TECHNOCORE_PASSPHRASE_FILE, or run on a TTY");
    }
    if (purpose === "load") {
        return promptHidden(`Passphrase for ${resolve(keyPath)}: `);
    }
    const first = await promptHidden("New identity passphrase (12+ characters): ");
    const second = await promptHidden("Confirm identity passphrase: ");
    if (first !== second)
        throw new IdentityError("passphrases do not match");
    if (first.length < 12) {
        throw new IdentityError("passphrase must contain at least 12 characters");
    }
    return first;
}
function parseIntOption(value, label) {
    if (value === undefined)
        return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new UsageError(`${label} must be a non-negative integer`);
    }
    return parsed;
}
function parseFloatOption(value, label) {
    if (value === undefined)
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new UsageError(`${label} must be a finite number`);
    }
    return parsed;
}
/**
 * Report what `setup` did and what the operator still has to do.
 *
 * The client lines are printed in full rather than pointed at the README,
 * because the whole value of the default paths is that these commands carry no
 * paths and no secrets — showing them is the shortest honest documentation of
 * that, and they can be copied by someone who does not read code.
 */
function setupReport(result) {
    const state = result.created ? "created" : "already existed";
    const cursorConfig = '{"mcpServers":{"technocore":{"type":"stdio","command":"technocore-mcp"}}}';
    return (`identity    ${result.identityPath}  (${state})\n` +
        `passphrase  ${result.passphrasePath}  (${state}, mode 600)\n` +
        `did         ${result.did}\n` +
        `\nAdd the MCP server to an agent. These carry no paths and no secrets:\n` +
        `  Claude Code  claude mcp add technocore --scope user -- technocore-mcp\n` +
        `  Codex CLI    codex mcp add technocore -- technocore-mcp\n` +
        `  Cursor       put in ~/.cursor/mcp.json, then restart Cursor:\n` +
        `               ${cursorConfig}\n` +
        `\nThe two files together are the identity, and a lost DID cannot be\n` +
        `recovered or reissued, so back up this directory:\n` +
        `  ${technocoreHome()}\n`);
}
async function run(argv) {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            key: { type: "string" },
            "base-url": { type: "string", default: DEFAULT_BASE_URL },
            timeout: { type: "string" },
            nonce: { type: "string" },
            since: { type: "string" },
            limit: { type: "string" },
            wait: { type: "string" },
            follow: { type: "boolean", default: false },
            output: { type: "string" },
            "artifact-url": { type: "string" },
            "proof-file": { type: "string" },
            help: { type: "boolean", default: false },
            version: { type: "boolean", default: false },
        },
    });
    if (values.version) {
        const { APP_VERSION } = await import("./client.js");
        process.stdout.write(`${APP_VERSION}\n`);
        return 0;
    }
    const [command, ...rest] = positionals;
    if (values.help || command === undefined) {
        process.stdout.write(USAGE);
        return values.help ? 0 : 1;
    }
    const timeoutSeconds = parseFloatOption(values.timeout, "--timeout") ?? 20;
    const clientOptions = {
        baseUrl: values["base-url"],
        timeoutMs: timeoutSeconds * 1000,
    };
    const keyPath = resolveIdentityPath(values.key);
    switch (command) {
        case "setup": {
            const result = setupIdentity();
            process.stdout.write(setupReport(result));
            return 0;
        }
        case "init": {
            const passphrase = await resolvePassphrase("create", keyPath);
            const did = createIdentityFile(keyPath, passphrase);
            process.stdout.write(`${did}\n`);
            return 0;
        }
        case "did": {
            const passphrase = await resolvePassphrase("load", keyPath);
            const privateKey = loadIdentity(keyPath, passphrase);
            process.stdout.write(`${didFromPrivateKey(privateKey)}\n`);
            return 0;
        }
        case "say": {
            const [room, text] = rest;
            if (room === undefined || text === undefined) {
                throw new UsageError("say requires <room> and <text>");
            }
            const passphrase = await resolvePassphrase("load", keyPath);
            const privateKey = loadIdentity(keyPath, passphrase);
            const client = new TechnocoreClient(clientOptions);
            const sayOptions = values.nonce !== undefined ? { nonce: values.nonce } : {};
            const response = await client.say(privateKey, room, text, sayOptions);
            process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
            return 0;
        }
        case "read": {
            const [room] = rest;
            if (room === undefined)
                throw new UsageError("read requires <room>");
            const client = new TechnocoreClient(clientOptions);
            const since = parseIntOption(values.since, "--since");
            const limit = parseIntOption(values.limit, "--limit") ?? 50;
            const wait = parseFloatOption(values.wait, "--wait");
            if (!values.follow) {
                const response = await client.readRoom(room, {
                    ...(since !== undefined ? { since } : {}),
                    limit,
                    ...(wait !== undefined ? { wait } : {}),
                });
                process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
                return 0;
            }
            let cursor = since;
            if (cursor === undefined) {
                const initial = await client.readRoom(room, { limit });
                process.stdout.write(`${JSON.stringify(initial)}\n`);
                cursor = initial.last_seq;
            }
            const followWait = wait ?? 10;
            process.stderr.write(`following ${room} after sequence ${cursor}; waiting up to ` +
                `${followWait} seconds per request (Ctrl+C to stop)\n`);
            for await (const response of client.follow(room, {
                since: cursor,
                limit,
                wait: followWait,
            })) {
                process.stdout.write(`${JSON.stringify(response)}\n`);
            }
            return 0;
        }
        case "proof": {
            const [artifactUrl, commit] = rest;
            if (artifactUrl === undefined || commit === undefined) {
                throw new UsageError("proof requires <artifact_url> and <commit>");
            }
            const passphrase = await resolvePassphrase("load", keyPath);
            const privateKey = loadIdentity(keyPath, passphrase);
            const proof = createContributionProof(privateKey, artifactUrl, commit);
            const serialized = `${JSON.stringify(proof, Object.keys(proof).sort(), 2)}\n`;
            if (values.output !== undefined) {
                const outputPath = resolve(values.output);
                try {
                    writeFileSync(outputPath, serialized, { flag: "wx", mode: 0o644 });
                }
                catch (error) {
                    if (error.code === "EEXIST") {
                        throw new ProtocolError(`refusing to overwrite existing file: ${outputPath}`);
                    }
                    throw error;
                }
                process.stdout.write(`${outputPath}\n`);
            }
            else {
                process.stdout.write(serialized);
            }
            return 0;
        }
        case "verify-proof": {
            const [proofFile] = rest;
            if (proofFile === undefined) {
                throw new UsageError("verify-proof requires <proof_file>");
            }
            const parsed = readProofObject(proofFile);
            verifyContributionProof(parsed);
            process.stdout.write(`valid proof for ${parsed["did"]}\n`);
            return 0;
        }
        case "announce": {
            const [room, seqText] = rest;
            if (room === undefined || seqText === undefined) {
                throw new UsageError("announce requires <room> and <seq>");
            }
            const seq = parseIntOption(seqText, "<seq>");
            if (seq === undefined)
                throw new UsageError("<seq> must be an integer");
            const passphrase = await resolvePassphrase("load", keyPath);
            const did = didFromPrivateKey(loadIdentity(keyPath, passphrase));
            const proofFile = values["proof-file"];
            const proof = proofFile === undefined
                ? undefined
                : announcedProof(readProofObject(proofFile), did);
            process.stdout.write(postAnnouncement({
                did,
                room,
                seq,
                artifactUrl: values["artifact-url"],
                proof,
            }));
            return 0;
        }
        case "compose": {
            const [summary] = rest;
            if (summary === undefined) {
                throw new UsageError("compose requires <summary>");
            }
            process.stdout.write(`${roomAnnouncement({ artifactUrl: values["artifact-url"], summary })}\n`);
            return 0;
        }
        default:
            throw new UsageError(`unsupported command: ${command}`);
    }
}
run(process.argv.slice(2))
    .then((code) => {
    process.exitCode = code;
})
    .catch((error) => {
    if (error instanceof UsageError ||
        error instanceof IdentityError ||
        error instanceof ProtocolError ||
        error instanceof NetworkError) {
        process.stderr.write(`error: ${error.message}\n`);
        process.exitCode = 1;
        return;
    }
    if (error?.name === "AbortError") {
        process.stderr.write("cancelled\n");
        process.exitCode = 130;
        return;
    }
    throw error;
});
