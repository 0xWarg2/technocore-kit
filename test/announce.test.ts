import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAX_MESSAGE_CHARS,
  ProtocolError,
  announcedProof,
  createContributionProof,
  postAnnouncement,
  privateKeyFromSeed,
  roomAnnouncement,
} from "../src/index.ts";

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/vectors.json", import.meta.url), "utf-8"),
);
const privateKey = privateKeyFromSeed(
  Uint8Array.from(Buffer.from(vectors.seed_hex, "hex")),
);
const did: string = vectors.did;
const artifactUrl: string = vectors.proof.artifact_url;
const proof = announcedProof(vectors.proof, did);

test("the post block reports the room and sequence it was given", () => {
  const block = postAnnouncement({ did, room: "technocore", seq: 337, proof });
  assert.match(block, new RegExp(`^DID: ${did}$`, "m"));
  assert.match(block, /^Room: technocore$/m);
  assert.match(block, /^Sequence: 337$/m);
  assert.match(
    block,
    new RegExp(`^Contribution \\+ signed proof: ${artifactUrl}$`, "m"),
  );
  assert.match(block, new RegExp(`^Commit: ${vectors.proof.commit}$`, "m"));
  assert.ok(block.endsWith("\n"));
});

test("a post block without a proof claims no proof", () => {
  const block = postAnnouncement({ did, room: "lobby", seq: 0, artifactUrl });
  assert.match(block, new RegExp(`^Contribution: ${artifactUrl}$`, "m"));
  assert.doesNotMatch(block, /signed proof/);
  assert.doesNotMatch(block, /^Commit:/m);
  // seq 0 is a real sequence, not a missing one.
  assert.match(block, /^Sequence: 0$/m);
});

test("a post block omits the contribution line when there is nothing to link", () => {
  const block = postAnnouncement({ did, room: "lobby", seq: 12 });
  assert.doesNotMatch(block, /Contribution/);
  assert.match(block, /^Sequence: 12$/m);
});

test("announcing someone else's proof is refused", () => {
  const otherKey = privateKeyFromSeed(new Uint8Array(32).fill(7));
  const otherProof = createContributionProof(
    otherKey,
    artifactUrl,
    vectors.proof.commit,
  );
  assert.notEqual(otherProof.did, did);
  // The signature is perfectly valid; it is simply not this agent's claim.
  assert.throws(
    () => announcedProof(otherProof as unknown as Record<string, unknown>, did),
    ProtocolError,
  );
});

test("an unverifiable proof never reaches an announcement", () => {
  assert.throws(
    () => announcedProof({ ...vectors.proof, commit: "b".repeat(40) }, did),
    (error: Error) => error.name !== "TypeError",
  );
  assert.throws(
    () => announcedProof({ ...vectors.proof, schema: "other" }, did),
    ProtocolError,
  );
});

test("a proof outranks a disagreeing artifact URL rather than being ignored", () => {
  assert.throws(
    () =>
      postAnnouncement({
        did,
        room: "technocore",
        seq: 337,
        artifactUrl: "https://github.com/someone/else",
        proof,
      }),
    ProtocolError,
  );
  // Agreeing is fine.
  const block = postAnnouncement({
    did,
    room: "technocore",
    seq: 337,
    artifactUrl,
    proof,
  });
  assert.match(block, new RegExp(artifactUrl.replace(/\//g, "\\/")));
});

test("post blocks reject malformed DIDs, rooms, and sequences", () => {
  const base = { did, room: "technocore", seq: 337 };
  assert.throws(() => postAnnouncement({ ...base, did: "z6Mk" }), ProtocolError);
  assert.throws(
    () => postAnnouncement({ ...base, did: `${did}extra` }),
    ProtocolError,
  );
  assert.throws(() => postAnnouncement({ ...base, room: "Technocore" }), Error);
  assert.throws(() => postAnnouncement({ ...base, seq: -1 }), ProtocolError);
  assert.throws(() => postAnnouncement({ ...base, seq: 1.5 }), ProtocolError);
  assert.throws(
    () => postAnnouncement({ ...base, artifactUrl: "http://x.test/y" }),
    ProtocolError,
  );
});

test("the room line is a single line that say would accept", () => {
  const line = roomAnnouncement({
    artifactUrl,
    summary: "A TypeScript client, CLI and MCP server for Technocore.",
  });
  assert.equal(line.split("\n").length, 1);
  assert.equal(
    line,
    `I published ${artifactUrl} — A TypeScript client, CLI and MCP server for Technocore.`,
  );
  // Normalization is not cosmetic: it is what keeps say from rejecting this.
  assert.equal(
    roomAnnouncement({ summary: "  spread\tover\nlines  " }),
    "spread over lines",
  );
});

test("the room line refuses text a room would reject", () => {
  assert.throws(() => roomAnnouncement({ summary: "   " }), ProtocolError);
  assert.throws(
    () => roomAnnouncement({ summary: "x".repeat(MAX_MESSAGE_CHARS + 1) }),
    ProtocolError,
  );
  // Length is counted in code points, so an emoji summary at the boundary
  // must fail for its real length rather than its UTF-16 size.
  assert.throws(
    () => roomAnnouncement({ summary: "🙂".repeat(MAX_MESSAGE_CHARS + 1) }),
    ProtocolError,
  );
  assert.doesNotThrow(() =>
    roomAnnouncement({ summary: "🙂".repeat(MAX_MESSAGE_CHARS) }),
  );
});
