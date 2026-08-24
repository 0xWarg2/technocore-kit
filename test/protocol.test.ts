import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  IdentityError,
  ProtocolError,
  base58btcDecode,
  base58btcEncode,
  contributionPayload,
  createContributionProof,
  createIdentityFile,
  didFromPrivateKey,
  loadIdentity,
  messagePayload,
  nextNonce,
  normalizeMessage,
  passphraseFromEnv,
  privateKeyFromSeed,
  rawPublicKeyFromDid,
  signBytes,
  validateBaseUrl,
  validateNonce,
  verifyBytes,
  verifyContributionProof,
} from "../src/index.ts";

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/vectors.json", import.meta.url), "utf-8"),
);
const seed = Uint8Array.from(Buffer.from(vectors.seed_hex, "hex"));
const privateKey = privateKeyFromSeed(seed);

test("base58btc round-trips and preserves leading zeroes", () => {
  const cases = [
    Uint8Array.of(),
    Uint8Array.of(0),
    Uint8Array.of(0, 0, 1, 2, 3),
    Uint8Array.from({ length: 34 }, (_, i) => (i * 7 + 1) % 256),
  ];
  for (const bytes of cases) {
    assert.deepEqual(base58btcDecode(base58btcEncode(bytes)), bytes);
  }
  assert.throws(() => base58btcDecode("0OIl"), ProtocolError);
});

test("DID derivation matches the Python reference vector", () => {
  assert.equal(didFromPrivateKey(privateKey), vectors.did);
  const raw = rawPublicKeyFromDid(vectors.did);
  assert.equal(raw.length, 32);
  assert.throws(() => rawPublicKeyFromDid("did:key:z6Mkinvalid"), ProtocolError);
  assert.throws(() => rawPublicKeyFromDid("did:web:example.com"), ProtocolError);
});

test("normalization matches the server sweep", () => {
  const { raw_text, normalized } = vectors.message;
  assert.equal(normalizeMessage(raw_text), normalized);
  assert.equal(normalizeMessage("plain\u200btext "), "plain text");
  assert.throws(() => normalizeMessage("\u200b \r\n  "), ProtocolError);
  // Length is counted in code points, so 4096 astral characters pass.
  assert.equal(normalizeMessage("🤖".repeat(4096)), "🤖".repeat(4096));
  assert.throws(() => normalizeMessage("🤖".repeat(4097)), ProtocolError);
});

test("signed payload bytes and signature match the Python reference", () => {
  const { room, nonce, raw_text, payload_utf8, signature } = vectors.message;
  const { normalized, payload } = messagePayload(room, nonce, raw_text);
  assert.equal(normalized, vectors.message.normalized);
  assert.equal(Buffer.from(payload).toString("utf-8"), payload_utf8);
  assert.equal(signBytes(privateKey, payload), signature);
  verifyBytes(vectors.did, signature, payload);
  const tampered = Uint8Array.from(payload);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => verifyBytes(vectors.did, signature, tampered), IdentityError);
});

test("contribution proof matches the Python reference", () => {
  const proof = createContributionProof(
    privateKey,
    vectors.proof.artifact_url,
    vectors.proof.commit,
  );
  assert.deepEqual(proof, vectors.proof);
  verifyContributionProof(proof as unknown as Record<string, unknown>);
  const canonical = Buffer.from(
    contributionPayload(vectors.proof.artifact_url, "A".repeat(40)),
  ).toString("utf-8");
  assert.equal(canonical, vectors.proof_payload_canonical);
});

test("contribution proof validation rejects bad inputs", () => {
  assert.throws(
    () => contributionPayload("http://github.com/x/y", "a".repeat(40)),
    ProtocolError,
  );
  assert.throws(
    () => contributionPayload("https://github.com/x/y#frag", "a".repeat(40)),
    ProtocolError,
  );
  assert.throws(
    () => contributionPayload("https://user:pw@github.com/x", "a".repeat(40)),
    ProtocolError,
  );
  assert.throws(
    () => contributionPayload("https://github.com/x/y", "abc123"),
    ProtocolError,
  );
  const tampered = { ...vectors.proof, commit: "b".repeat(40) };
  assert.throws(() => verifyContributionProof(tampered), IdentityError);
  assert.throws(
    () => verifyContributionProof({ ...vectors.proof, schema: "other" }),
    ProtocolError,
  );
});

test("identity files are encrypted, mode 0600, and never overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "technocore-kit-"));
  const keyPath = join(dir, "identity.pem");
  assert.throws(() => createIdentityFile(keyPath, "short"), IdentityError);
  const did = createIdentityFile(keyPath, "a passphrase with length");
  assert.match(did, /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  assert.match(readFileSync(keyPath, "utf-8"), /BEGIN ENCRYPTED PRIVATE KEY/);
  assert.throws(
    () => createIdentityFile(keyPath, "another passphrase!!"),
    IdentityError,
  );
  const loaded = loadIdentity(keyPath, "a passphrase with length");
  assert.equal(didFromPrivateKey(loaded), did);
  assert.throws(() => loadIdentity(keyPath, "wrong passphrase!!"), IdentityError);
});

test("unencrypted private keys are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "technocore-kit-"));
  const keyPath = join(dir, "plain.pem");
  const { privateKey: plain } = generateKeyPairSync("ed25519");
  writeFileSync(keyPath, plain.export({ type: "pkcs8", format: "pem" }));
  assert.throws(() => loadIdentity(keyPath, "irrelevant pass"), IdentityError);
});

test("identity PEM interop: loads a key encrypted by the Python reference", () => {
  const dir = mkdtempSync(join(tmpdir(), "technocore-kit-"));
  const keyPath = join(dir, "python.pem");
  writeFileSync(keyPath, vectors.python_encrypted_pem);
  const loaded = loadIdentity(keyPath, vectors.pem_passphrase);
  assert.equal(didFromPrivateKey(loaded), vectors.did);
});

test("passphrases resolve from the env directly or from a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "technocore-kit-"));
  const file = join(dir, "pass.txt");

  // The direct variable wins, so an inherited FILE cannot shadow it.
  writeFileSync(file, "from-the-file\n");
  assert.equal(
    passphraseFromEnv({
      TECHNOCORE_PASSPHRASE: "direct",
      TECHNOCORE_PASSPHRASE_FILE: file,
    }),
    "direct",
  );

  // Exactly one trailing newline is stripped; interior whitespace survives.
  assert.equal(passphraseFromEnv({ TECHNOCORE_PASSPHRASE_FILE: file }), "from-the-file");
  writeFileSync(file, "two words\r\n");
  assert.equal(passphraseFromEnv({ TECHNOCORE_PASSPHRASE_FILE: file }), "two words");
  writeFileSync(file, "trailing-blank\n\n");
  assert.equal(passphraseFromEnv({ TECHNOCORE_PASSPHRASE_FILE: file }), "trailing-blank\n");

  assert.equal(passphraseFromEnv({}), undefined);
  assert.equal(passphraseFromEnv({ TECHNOCORE_PASSPHRASE: "" }), undefined);

  writeFileSync(file, "\n");
  assert.throws(() => passphraseFromEnv({ TECHNOCORE_PASSPHRASE_FILE: file }), IdentityError);
  assert.throws(
    () => passphraseFromEnv({ TECHNOCORE_PASSPHRASE_FILE: join(dir, "absent") }),
    IdentityError,
  );
});

test("nonces are wall-clock nanoseconds within 19 digits", () => {
  const nonce = nextNonce();
  assert.match(nonce, /^[0-9]{1,19}$/);
  assert.equal(validateNonce("1"), "1");
  assert.throws(() => validateNonce("1".repeat(20)), ProtocolError);
  assert.throws(() => validateNonce("12a"), ProtocolError);
});

test("base URLs require HTTPS except loopback", () => {
  assert.equal(validateBaseUrl("https://technocore.chat/"), "https://technocore.chat");
  assert.equal(
    validateBaseUrl("http://localhost:8080"),
    "http://localhost:8080",
  );
  assert.equal(
    validateBaseUrl("http://127.0.0.1:3000"),
    "http://127.0.0.1:3000",
  );
  assert.throws(() => validateBaseUrl("http://technocore.chat"), ProtocolError);
  assert.throws(() => validateBaseUrl("https://x.dev/path"), ProtocolError);
  assert.throws(() => validateBaseUrl("https://x.dev/?q=1"), ProtocolError);
  assert.throws(() => validateBaseUrl("https://u:p@x.dev"), ProtocolError);
});
