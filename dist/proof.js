/**
 * Signed contribution proofs: a deterministic, canonical-JSON payload that
 * links a DID to one published revision (an HTTPS artifact URL plus an
 * immutable git commit), matching the `technocore-contribution-v1` schema
 * used by the reference Python implementation.
 */
import { didFromPrivateKey, signBytes, verifyBytes } from "./identity.js";
import { COMMIT_PATTERN, ProtocolError } from "./protocol.js";
export const CONTRIBUTION_SCHEMA = "technocore-contribution-v1";
export const CONTRIBUTION_PROOF_SCHEMA = "technocore-contribution-proof-v1";
/** Build the deterministic canonical-JSON payload bytes for one revision. */
export function contributionPayload(artifactUrl, commit) {
    if (typeof artifactUrl !== "string" || typeof commit !== "string") {
        throw new ProtocolError("artifact URL and commit must be strings");
    }
    if (artifactUrl !== artifactUrl.trim()) {
        throw new ProtocolError("artifact URL must not contain surrounding whitespace");
    }
    let parsed;
    try {
        parsed = new URL(artifactUrl);
    }
    catch {
        throw new ProtocolError("artifact URL is malformed");
    }
    if (parsed.protocol !== "https:" || !parsed.host || parsed.hash) {
        throw new ProtocolError("artifact URL must be an absolute HTTPS URL without a fragment");
    }
    if (parsed.username || parsed.password) {
        throw new ProtocolError("artifact URL must not contain embedded credentials");
    }
    if (!COMMIT_PATTERN.test(commit)) {
        throw new ProtocolError("commit must be a complete 40- or 64-character hexadecimal revision");
    }
    // Canonical form: keys sorted, compact separators, raw UTF-8 — identical
    // bytes to Python's json.dumps(..., sort_keys=True, separators=(",", ":")).
    const canonical = JSON.stringify({
        artifact_url: artifactUrl,
        commit: commit.toLowerCase(),
        schema: CONTRIBUTION_SCHEMA,
    });
    return new TextEncoder().encode(canonical);
}
/** Sign a public artifact URL and immutable hexadecimal revision. */
export function createContributionProof(privateKey, artifactUrl, commit) {
    const payload = contributionPayload(artifactUrl, commit);
    return {
        schema: CONTRIBUTION_PROOF_SCHEMA,
        did: didFromPrivateKey(privateKey),
        artifact_url: artifactUrl,
        commit: commit.toLowerCase(),
        signature: signBytes(privateKey, payload),
    };
}
/** Validate a contribution proof's shape and Ed25519 signature. */
export function verifyContributionProof(proof) {
    if (proof["schema"] !== CONTRIBUTION_PROOF_SCHEMA) {
        throw new ProtocolError("unsupported contribution proof schema");
    }
    for (const field of ["did", "artifact_url", "commit", "signature"]) {
        if (typeof proof[field] !== "string") {
            throw new ProtocolError("contribution proof is missing required string fields");
        }
    }
    const payload = contributionPayload(proof["artifact_url"], proof["commit"]);
    verifyBytes(proof["did"], proof["signature"], payload);
}
