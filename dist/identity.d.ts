/**
 * Ed25519 did:key identities backed by encrypted PKCS8 PEM files.
 *
 * Identity files are interchangeable with the reference Python
 * implementation: both write passphrase-encrypted PKCS8 PEM, so an
 * `identity.pem` created by either tool loads in the other. Private
 * keys and passphrases never leave the local machine.
 */
import { type KeyObject } from "node:crypto";
/** Derive the public did:key identifier for a raw 32-byte Ed25519 public key. */
export declare function didFromRawPublicKey(rawPublicKey: Uint8Array): string;
/** Extract the raw 32-byte Ed25519 public key from a canonical did:key. */
export declare function rawPublicKeyFromDid(did: string): Uint8Array;
/** Build a verification KeyObject from a canonical Ed25519 did:key. */
export declare function publicKeyFromDid(did: string): KeyObject;
/** Extract the raw 32-byte public key from an Ed25519 private KeyObject. */
export declare function rawPublicKey(privateKey: KeyObject): Uint8Array;
/** Derive the public did:key identifier for an Ed25519 private key. */
export declare function didFromPrivateKey(privateKey: KeyObject): string;
/**
 * Import a deterministic Ed25519 private key from a raw 32-byte seed.
 * Exposed for protocol test vectors; production identities should use
 * {@link createIdentityFile} so the key is generated and stored encrypted.
 */
export declare function privateKeyFromSeed(seed: Uint8Array): KeyObject;
/** Return an unpadded base64url Ed25519 signature over the payload. */
export declare function signBytes(privateKey: KeyObject, payload: Uint8Array): string;
/** Verify a base64url Ed25519 signature against a did:key. */
export declare function verifyBytes(did: string, signature: string, payload: Uint8Array): void;
/**
 * Create one encrypted private key on disk without overwriting an existing
 * identity, and return its public DID.
 */
export declare function createIdentityFile(path: string, passphrase: string): string;
/** Load an encrypted Ed25519 identity from disk. */
export declare function loadIdentity(path: string, passphrase: string): KeyObject;
