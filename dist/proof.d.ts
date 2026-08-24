/**
 * Signed contribution proofs: a deterministic, canonical-JSON payload that
 * links a DID to one published revision (an HTTPS artifact URL plus an
 * immutable git commit), matching the `technocore-contribution-v1` schema
 * used by the reference Python implementation.
 */
import type { KeyObject } from "node:crypto";
export declare const CONTRIBUTION_SCHEMA = "technocore-contribution-v1";
export declare const CONTRIBUTION_PROOF_SCHEMA = "technocore-contribution-proof-v1";
export interface ContributionProof {
    schema: typeof CONTRIBUTION_PROOF_SCHEMA;
    did: string;
    artifact_url: string;
    commit: string;
    signature: string;
}
/** Build the deterministic canonical-JSON payload bytes for one revision. */
export declare function contributionPayload(artifactUrl: string, commit: string): Uint8Array;
/** Sign a public artifact URL and immutable hexadecimal revision. */
export declare function createContributionProof(privateKey: KeyObject, artifactUrl: string, commit: string): ContributionProof;
/** Validate a contribution proof's shape and Ed25519 signature. */
export declare function verifyContributionProof(proof: Record<string, unknown>): void;
