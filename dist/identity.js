/**
 * Ed25519 did:key identities backed by encrypted PKCS8 PEM files.
 *
 * Identity files are interchangeable with the reference Python
 * implementation: both write passphrase-encrypted PKCS8 PEM, so an
 * `identity.pem` created by either tool loads in the other. Private
 * keys and passphrases never leave the local machine.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { IdentityError, MULTIBASE_LENGTH, MULTICODEC_ED25519, ProtocolError, SIGNATURE_PATTERN, base58btcDecode, base58btcEncode, } from "./protocol.js";
const MIN_PASSPHRASE_CHARS = 12;
/** Derive the public did:key identifier for a raw 32-byte Ed25519 public key. */
export function didFromRawPublicKey(rawPublicKey) {
    const prefixed = new Uint8Array(MULTICODEC_ED25519.length + rawPublicKey.length);
    prefixed.set(MULTICODEC_ED25519, 0);
    prefixed.set(rawPublicKey, MULTICODEC_ED25519.length);
    const multibase = "z" + base58btcEncode(prefixed);
    if (multibase.length !== MULTIBASE_LENGTH || !multibase.startsWith("z6Mk")) {
        throw new IdentityError("generated an invalid Ed25519 did:key");
    }
    return "did:key:" + multibase;
}
/** Extract the raw 32-byte Ed25519 public key from a canonical did:key. */
export function rawPublicKeyFromDid(did) {
    const prefix = "did:key:";
    if (typeof did !== "string" || !did.startsWith(prefix)) {
        throw new ProtocolError("DID must start with 'did:key:z6Mk'");
    }
    const multibase = did.slice(prefix.length);
    if (multibase.length !== MULTIBASE_LENGTH || !multibase.startsWith("z6Mk")) {
        throw new ProtocolError("DID must be the canonical 48-character Ed25519 multibase form");
    }
    const decoded = base58btcDecode(multibase.slice(1));
    if (decoded.length !== 34 ||
        decoded[0] !== MULTICODEC_ED25519[0] ||
        decoded[1] !== MULTICODEC_ED25519[1]) {
        throw new ProtocolError("DID must contain an ed25519-pub key");
    }
    return decoded.slice(2);
}
/** Build a verification KeyObject from a canonical Ed25519 did:key. */
export function publicKeyFromDid(did) {
    const raw = rawPublicKeyFromDid(did);
    try {
        return createPublicKey({
            key: {
                kty: "OKP",
                crv: "Ed25519",
                x: Buffer.from(raw).toString("base64url"),
            },
            format: "jwk",
        });
    }
    catch {
        throw new ProtocolError("DID contains an invalid Ed25519 public key");
    }
}
/** Extract the raw 32-byte public key from an Ed25519 private KeyObject. */
export function rawPublicKey(privateKey) {
    const jwk = createPublicKey(privateKey).export({ format: "jwk" });
    if (jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
        throw new IdentityError("identity must contain an Ed25519 private key");
    }
    return new Uint8Array(Buffer.from(jwk.x, "base64url"));
}
/** Derive the public did:key identifier for an Ed25519 private key. */
export function didFromPrivateKey(privateKey) {
    return didFromRawPublicKey(rawPublicKey(privateKey));
}
/**
 * Import a deterministic Ed25519 private key from a raw 32-byte seed.
 * Exposed for protocol test vectors; production identities should use
 * {@link createIdentityFile} so the key is generated and stored encrypted.
 */
export function privateKeyFromSeed(seed) {
    if (seed.length !== 32) {
        throw new IdentityError("Ed25519 seed must contain exactly 32 bytes");
    }
    // PKCS8 DER prefix for an Ed25519 private key (RFC 8410).
    const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
    return createPrivateKey({
        key: Buffer.concat([prefix, Buffer.from(seed)]),
        format: "der",
        type: "pkcs8",
    });
}
/** Return an unpadded base64url Ed25519 signature over the payload. */
export function signBytes(privateKey, payload) {
    const encoded = Buffer.from(cryptoSign(null, payload, privateKey)).toString("base64url");
    if (!SIGNATURE_PATTERN.test(encoded)) {
        throw new IdentityError("generated an invalid Ed25519 signature encoding");
    }
    return encoded;
}
/** Verify a base64url Ed25519 signature against a did:key. */
export function verifyBytes(did, signature, payload) {
    if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
        throw new ProtocolError("signature must contain 86 unpadded base64url characters");
    }
    const rawSignature = Buffer.from(signature, "base64url");
    const valid = cryptoVerify(null, payload, publicKeyFromDid(did), rawSignature);
    if (!valid) {
        throw new IdentityError("signature does not match the DID and payload");
    }
}
/**
 * Create one encrypted private key on disk without overwriting an existing
 * identity, and return its public DID.
 */
export function createIdentityFile(path, passphrase) {
    const resolved = resolve(path);
    if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_CHARS) {
        throw new IdentityError(`identity passphrase must contain at least ${MIN_PASSPHRASE_CHARS} characters`);
    }
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({
        type: "pkcs8",
        format: "pem",
        cipher: "aes-256-cbc",
        passphrase,
    });
    try {
        // "wx" = O_CREAT | O_EXCL: fail instead of overwriting an identity.
        writeFileSync(resolved, pem, { flag: "wx", mode: 0o600 });
    }
    catch (error) {
        const code = error.code;
        if (code === "EEXIST") {
            throw new IdentityError(`refusing to overwrite existing identity: ${resolved}`);
        }
        throw new IdentityError(`cannot write encrypted identity ${resolved}: ${String(error)}`);
    }
    return didFromPrivateKey(privateKey);
}
/** Load an encrypted Ed25519 identity from disk. */
export function loadIdentity(path, passphrase) {
    const resolved = resolve(path);
    let pemBytes;
    try {
        pemBytes = readFileSync(resolved);
    }
    catch (error) {
        throw new IdentityError(`cannot read identity ${resolved}: ${String(error)}`);
    }
    if (!pemBytes.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")) {
        throw new IdentityError("unencrypted private keys are not supported; create an encrypted identity");
    }
    let privateKey;
    try {
        privateKey = createPrivateKey({ key: pemBytes, passphrase });
    }
    catch {
        throw new IdentityError("incorrect passphrase or invalid encrypted identity");
    }
    if (privateKey.asymmetricKeyType !== "ed25519") {
        throw new IdentityError("identity must contain an Ed25519 private key");
    }
    return privateKey;
}
