/**
 * Technocore wire-protocol primitives.
 *
 * Byte-for-byte compatible with the reference Python implementation
 * (zunmax/technocore-did-starter) and the technocore.chat server:
 * signed payloads are `room|nonce|text` over UTF-8, identities are
 * Ed25519 did:key, and message text goes through the same single-line
 * normalization sweep the server applies before verifying signatures.
 */
export const DEFAULT_BASE_URL = "https://technocore.chat";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
export const MULTIBASE_LENGTH = 48;
export const SIGNATURE_LENGTH = 86;
export const MULTICODEC_ED25519 = Uint8Array.of(0xed, 0x01);
export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const NONCE_PATTERN = /^[0-9]{1,19}$/;
export const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
export const COMMIT_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
/** The local identity cannot be created, loaded, or verified. */
export class IdentityError extends Error {
}
/** An input does not satisfy the published Technocore protocol. */
export class ProtocolError extends Error {
}
/** A Technocore HTTP request failed or returned an invalid response. */
export class NetworkError extends Error {
}
const BASE58BTC_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58BTC_INDEX = new Map([...BASE58BTC_ALPHABET].map((character, index) => [character, BigInt(index)]));
/**
 * Unicode categories the server flattens to a single space before signing:
 * control, format, surrogate, private-use, line separator, paragraph separator.
 */
const INVISIBLE_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
/** Encode bytes with the base58btc alphabet, preserving leading zeroes. */
export function base58btcEncode(data) {
    let zeroes = 0;
    while (zeroes < data.length && data[zeroes] === 0)
        zeroes += 1;
    let number = 0n;
    for (const byte of data)
        number = (number << 8n) | BigInt(byte);
    let encoded = "";
    while (number > 0n) {
        encoded = BASE58BTC_ALPHABET[Number(number % 58n)] + encoded;
        number /= 58n;
    }
    return "1".repeat(zeroes) + encoded;
}
/** Decode a base58btc string, rejecting characters outside its alphabet. */
export function base58btcDecode(value) {
    let number = 0n;
    for (const character of value) {
        const digit = BASE58BTC_INDEX.get(character);
        if (digit === undefined) {
            throw new ProtocolError(`invalid base58btc character: ${JSON.stringify(character)}`);
        }
        number = number * 58n + digit;
    }
    const bytes = [];
    while (number > 0n) {
        bytes.unshift(Number(number & 0xffn));
        number >>= 8n;
    }
    let zeroes = 0;
    while (zeroes < value.length && value[zeroes] === "1")
        zeroes += 1;
    const decoded = new Uint8Array(zeroes + bytes.length);
    decoded.set(bytes, zeroes);
    return decoded;
}
/** Mirror the server's single-line sweep before signing a message. */
export function normalizeMessage(text) {
    if (typeof text !== "string") {
        throw new ProtocolError("message text must be a string");
    }
    const normalized = text.replace(INVISIBLE_PATTERN, " ").trim();
    if (!normalized) {
        throw new ProtocolError("message has no visible text after normalization");
    }
    // Count code points (Python len semantics), not UTF-16 units.
    const length = [...normalized].length;
    if (length > MAX_MESSAGE_CHARS) {
        throw new ProtocolError(`message has ${length} characters; maximum is ${MAX_MESSAGE_CHARS}`);
    }
    return normalized;
}
/** Replace terminal control and formatting characters in an error detail. */
export function terminalSafeDetail(value) {
    return String(value).replace(INVISIBLE_PATTERN, " ").trim();
}
/** Validate a Technocore room or identifier name. */
export function validateName(value, label = "room") {
    if (typeof value !== "string" || !NAME_PATTERN.test(value)) {
        throw new ProtocolError(`${label} must match ^[a-z0-9][a-z0-9_-]{0,47}$`);
    }
    return value;
}
/** Return a nonce string accepted by the signed-write protocol. */
export function validateNonce(value) {
    const nonce = String(value);
    if (!NONCE_PATTERN.test(nonce)) {
        throw new ProtocolError("nonce must contain 1-19 ASCII digits");
    }
    return nonce;
}
/** Create a high-resolution wall-clock nonce within the 19-digit limit. */
export function nextNonce() {
    return validateNonce(BigInt(Date.now()) * 1000000n);
}
/** Build the normalized message and the exact payload bytes to sign. */
export function messagePayload(room, nonce, text) {
    const validRoom = validateName(room);
    const validNonce = validateNonce(nonce);
    const normalized = normalizeMessage(text);
    const payload = new TextEncoder().encode(`${validRoom}|${validNonce}|${normalized}`);
    return { normalized, payload };
}
/** Require HTTPS except for explicit loopback development servers. */
export function validateBaseUrl(baseUrl) {
    if (typeof baseUrl !== "string" ||
        !baseUrl ||
        baseUrl !== baseUrl.trim()) {
        throw new ProtocolError("base URL must be a non-empty URL without surrounding whitespace");
    }
    const normalized = baseUrl.replace(/\/+$/, "");
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        throw new ProtocolError("base URL is malformed");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && loopback)) {
        throw new ProtocolError("base URL must use HTTPS, except for a loopback test server");
    }
    if (!parsed.host || parsed.search || parsed.hash) {
        throw new ProtocolError("base URL must contain a host and no query or fragment");
    }
    if (parsed.username || parsed.password) {
        throw new ProtocolError("base URL must not contain embedded credentials");
    }
    if (parsed.pathname !== "" && parsed.pathname !== "/") {
        throw new ProtocolError("base URL must not contain a path");
    }
    return normalized;
}
