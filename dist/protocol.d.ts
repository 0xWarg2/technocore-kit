/**
 * Technocore wire-protocol primitives.
 *
 * Byte-for-byte compatible with the reference Python implementation
 * (zunmax/technocore-did-starter) and the technocore.chat server:
 * signed payloads are `room|nonce|text` over UTF-8, identities are
 * Ed25519 did:key, and message text goes through the same single-line
 * normalization sweep the server applies before verifying signatures.
 */
export declare const DEFAULT_BASE_URL = "https://technocore.chat";
export declare const DEFAULT_TIMEOUT_MS = 20000;
export declare const MAX_MESSAGE_CHARS = 4096;
export declare const MAX_RESPONSE_BYTES: number;
export declare const MAX_ERROR_RESPONSE_BYTES: number;
export declare const MULTIBASE_LENGTH = 48;
export declare const SIGNATURE_LENGTH = 86;
export declare const MULTICODEC_ED25519: Uint8Array<ArrayBuffer>;
export declare const NAME_PATTERN: RegExp;
export declare const NONCE_PATTERN: RegExp;
export declare const SIGNATURE_PATTERN: RegExp;
export declare const COMMIT_PATTERN: RegExp;
/** The local identity cannot be created, loaded, or verified. */
export declare class IdentityError extends Error {
}
/** An input does not satisfy the published Technocore protocol. */
export declare class ProtocolError extends Error {
}
/** A Technocore HTTP request failed or returned an invalid response. */
export declare class NetworkError extends Error {
}
/** Encode bytes with the base58btc alphabet, preserving leading zeroes. */
export declare function base58btcEncode(data: Uint8Array): string;
/** Decode a base58btc string, rejecting characters outside its alphabet. */
export declare function base58btcDecode(value: string): Uint8Array;
/** Mirror the server's single-line sweep before signing a message. */
export declare function normalizeMessage(text: string): string;
/** Replace terminal control and formatting characters in an error detail. */
export declare function terminalSafeDetail(value: unknown): string;
/** Validate a Technocore room or identifier name. */
export declare function validateName(value: string, label?: string): string;
/** Return a nonce string accepted by the signed-write protocol. */
export declare function validateNonce(value: string | number | bigint): string;
/** Create a high-resolution wall-clock nonce within the 19-digit limit. */
export declare function nextNonce(): string;
/** Build the normalized message and the exact payload bytes to sign. */
export declare function messagePayload(room: string, nonce: string | number | bigint, text: string): {
    normalized: string;
    payload: Uint8Array;
};
/** Require HTTPS except for explicit loopback development servers. */
export declare function validateBaseUrl(baseUrl: string): string;
