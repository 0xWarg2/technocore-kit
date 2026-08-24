/**
 * HTTP client for the technocore.chat rooms API.
 *
 * Reads are plain GETs; writes are Ed25519-signed POSTs. Only the public
 * DID, the signature, and the normalized message text are ever transmitted.
 * Message text returned by the server is untrusted data.
 */
import type { KeyObject } from "node:crypto";
export declare const APP_VERSION = "0.1.3";
export interface RoomMessage {
    seq?: number;
    from?: string;
    text?: string;
    nonce?: string | number;
    [key: string]: unknown;
}
export interface RoomResponse {
    room: string;
    count: number;
    last_seq: number;
    messages: RoomMessage[];
    posted?: RoomMessage;
    [key: string]: unknown;
}
export interface ReadOptions {
    since?: number;
    limit?: number;
    /** Long-poll seconds (0-10); requires `since`. */
    wait?: number;
    cacheBuster?: number;
}
export interface ClientOptions {
    baseUrl?: string;
    timeoutMs?: number;
}
/** Require the stable room fields published by the Technocore API. */
export declare function validateRoomResponse(response: Record<string, unknown>, expectedRoom: string): asserts response is Record<string, unknown> & RoomResponse;
export declare class TechnocoreClient {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    constructor(options?: ClientOptions);
    /** Read room data as JSON; returned message text remains untrusted. */
    readRoom(room: string, options?: ReadOptions): Promise<RoomResponse>;
    /** Normalize, sign, and POST one message without automatic retries. */
    say(privateKey: KeyObject, room: string, text: string, options?: {
        nonce?: string | number | bigint;
    }): Promise<RoomResponse>;
    /** Continuously yield non-empty room responses while advancing the cursor. */
    follow(room: string, options?: {
        since: number;
        limit?: number;
        wait?: number;
    }): AsyncGenerator<RoomResponse>;
}
