/**
 * HTTP client for the technocore.chat rooms API.
 *
 * Reads are plain GETs; writes are Ed25519-signed POSTs. Only the public
 * DID, the signature, and the normalized message text are ever transmitted.
 * Message text returned by the server is untrusted data.
 */
import { didFromPrivateKey, signBytes } from "./identity.js";
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, MAX_ERROR_RESPONSE_BYTES, MAX_RESPONSE_BYTES, NetworkError, ProtocolError, messagePayload, nextNonce, terminalSafeDetail, validateBaseUrl, validateName, validateNonce, } from "./protocol.js";
// Keep in sync with package.json.
export const APP_VERSION = "0.1.1";
const USER_AGENT = `technocore-kit/${APP_VERSION}`;
const DEFAULT_FOLLOW_WAIT_SECONDS = 10;
const MIN_FOLLOW_INTERVAL_MS = 500;
function validateTimeout(timeoutMs) {
    if (typeof timeoutMs !== "number" ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0) {
        throw new ProtocolError("timeout must be a finite number greater than zero");
    }
    return timeoutMs;
}
async function readBounded(body, maxBytes) {
    if (body === null)
        return new Uint8Array(0);
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maxBytes) {
                throw new NetworkError(`Technocore response exceeded the ${maxBytes}-byte safety limit`);
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return merged;
}
function decodeJsonObject(raw) {
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    }
    catch {
        throw new NetworkError("Technocore returned a response that was not valid UTF-8");
    }
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch {
        throw new NetworkError("Technocore returned a non-JSON response");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new NetworkError("Technocore returned JSON that was not an object");
    }
    return payload;
}
function isNonNegativeInt(value) {
    return (typeof value === "number" && Number.isInteger(value) && value >= 0);
}
/** Require the stable room fields published by the Technocore API. */
export function validateRoomResponse(response, expectedRoom) {
    if (response["room"] !== expectedRoom) {
        throw new NetworkError("Technocore returned data for a different room");
    }
    if (!isNonNegativeInt(response["count"])) {
        throw new NetworkError("Technocore returned an invalid room count");
    }
    if (!isNonNegativeInt(response["last_seq"])) {
        throw new NetworkError("Technocore returned an invalid last_seq cursor");
    }
    const messages = response["messages"];
    if (!Array.isArray(messages) ||
        messages.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
        throw new NetworkError("Technocore returned an invalid messages list");
    }
}
async function requestJson(url, init, timeoutMs, isWrite) {
    const timeoutDetail = isWrite
        ? "Technocore write timed out; its outcome is unknown, so read the room and " +
            "check your DID and nonce before retrying"
        : "Technocore request timed out";
    let response;
    try {
        response = await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(validateTimeout(timeoutMs)),
            redirect: "error",
        });
    }
    catch (error) {
        const name = error?.name;
        const cause = error?.cause;
        if (name === "TimeoutError" || cause?.name === "TimeoutError") {
            throw new NetworkError(timeoutDetail);
        }
        throw new NetworkError(`could not reach Technocore: ${terminalSafeDetail(cause?.message ?? error?.message ?? error)}`);
    }
    if (!response.ok) {
        let detail = "no response body";
        try {
            const raw = await readBounded(response.body, MAX_ERROR_RESPONSE_BYTES);
            const text = new TextDecoder("utf-8", { fatal: false })
                .decode(raw)
                .trim();
            detail = terminalSafeDetail(text) || response.statusText || detail;
        }
        catch {
            // Keep the fallback detail when the error body itself is oversized.
        }
        throw new NetworkError(`Technocore returned HTTP ${response.status}: ${detail}`);
    }
    const raw = await readBounded(response.body, MAX_RESPONSE_BYTES);
    return decodeJsonObject(raw);
}
export class TechnocoreClient {
    baseUrl;
    timeoutMs;
    constructor(options = {}) {
        this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
        this.timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }
    /** Read room data as JSON; returned message text remains untrusted. */
    async readRoom(room, options = {}) {
        const validRoom = validateName(room);
        const { since, limit = 50, wait, cacheBuster } = options;
        if (since !== undefined && !isNonNegativeInt(since)) {
            throw new ProtocolError("since must be zero or greater");
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
            throw new ProtocolError("limit must be between 1 and 200");
        }
        if (cacheBuster !== undefined && !isNonNegativeInt(cacheBuster)) {
            throw new ProtocolError("cache buster must be zero or greater");
        }
        if (wait !== undefined) {
            if (since === undefined) {
                throw new ProtocolError("wait requires a since cursor");
            }
            if (typeof wait !== "number" ||
                !Number.isFinite(wait) ||
                wait < 0 ||
                wait > 10) {
                throw new ProtocolError("wait must be between 0 and 10 seconds");
            }
            if (this.timeoutMs / 1000 <= wait) {
                throw new ProtocolError("timeout must be greater than wait for long polling");
            }
        }
        const query = new URLSearchParams({ format: "json", limit: String(limit) });
        if (since !== undefined)
            query.set("since", String(since));
        if (wait !== undefined)
            query.set("wait", String(wait));
        if (cacheBuster !== undefined)
            query.set("n", String(cacheBuster));
        const response = await requestJson(`${this.baseUrl}/r/${validRoom}?${query.toString()}`, {
            method: "GET",
            headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        }, this.timeoutMs, false);
        validateRoomResponse(response, validRoom);
        return response;
    }
    /** Normalize, sign, and POST one message without automatic retries. */
    async say(privateKey, room, text, options = {}) {
        const selectedNonce = validateNonce(options.nonce ?? nextNonce());
        const { normalized, payload } = messagePayload(room, selectedNonce, text);
        const did = didFromPrivateKey(privateKey);
        const body = JSON.stringify({
            did,
            sig: signBytes(privateKey, payload),
            nonce: selectedNonce,
            text: normalized,
        });
        const response = await requestJson(`${this.baseUrl}/r/${validateName(room)}?format=json`, {
            method: "POST",
            body,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": USER_AGENT,
            },
        }, this.timeoutMs, true);
        validateRoomResponse(response, room);
        const posted = response["posted"];
        if (typeof posted !== "object" || posted === null || Array.isArray(posted)) {
            throw new NetworkError("Technocore accepted the request without returning a posted record");
        }
        const postedRecord = posted;
        // 19-digit nonces exceed Number.MAX_SAFE_INTEGER, so compare strings as
        // BigInt; a numeric echo is compared under the same double rounding.
        let matchingNonce = false;
        const postedNonce = postedRecord.nonce;
        try {
            if (typeof postedNonce === "string") {
                matchingNonce = BigInt(postedNonce) === BigInt(selectedNonce);
            }
            else if (typeof postedNonce === "number") {
                matchingNonce = postedNonce === Number(selectedNonce);
            }
        }
        catch {
            matchingNonce = false;
        }
        const postedSeq = postedRecord.seq;
        const matchingRecord = postedRecord.from === did &&
            postedRecord.text === normalized &&
            matchingNonce &&
            typeof postedSeq === "number" &&
            Number.isInteger(postedSeq) &&
            postedSeq > 0;
        if (!matchingRecord) {
            throw new NetworkError("Technocore returned a posted record that does not match this identity");
        }
        if (!response.messages.some((message) => message.seq === postedSeq)) {
            throw new NetworkError("Technocore response did not include the newly posted sequence");
        }
        return response;
    }
    /** Continuously yield non-empty room responses while advancing the cursor. */
    async *follow(room, options = { since: 0 }) {
        const wait = options.wait ?? DEFAULT_FOLLOW_WAIT_SECONDS;
        if (typeof wait !== "number" ||
            !Number.isFinite(wait) ||
            wait <= 0 ||
            wait > 10) {
            throw new ProtocolError("follow wait must be greater than zero and at most 10 seconds");
        }
        let cursor = options.since;
        let cacheBuster = 0;
        for (;;) {
            const started = performance.now();
            const response = await this.readRoom(room, {
                since: cursor,
                limit: options.limit ?? 50,
                wait,
                cacheBuster,
            });
            cacheBuster += 1;
            if (response.messages.length > 0) {
                const nextCursor = response.last_seq;
                if (nextCursor <= cursor) {
                    throw new NetworkError("Technocore returned messages without advancing last_seq");
                }
                cursor = nextCursor;
                yield response;
            }
            const elapsed = performance.now() - started;
            if (elapsed < MIN_FOLLOW_INTERVAL_MS) {
                await new Promise((resolveSleep) => setTimeout(resolveSleep, MIN_FOLLOW_INTERVAL_MS - elapsed));
            }
        }
    }
}
