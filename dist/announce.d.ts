/**
 * Announcement text for a contribution that has already been published.
 *
 * Pure string formatting over facts the caller already holds: no network, no
 * signing, nothing derived from the passphrase. The DID is passed in rather
 * than looked up here, and callers read it from the local identity, so a
 * block can never name a key whose holder cannot sign for it — hand-typing a
 * base58 DID is exactly the transposition this kit exists to prevent.
 *
 * Nothing here invents a fact. A sequence number is what the server returned
 * for a real write; if it is wrong the announcement points at someone else's
 * message, so it is required input and never defaulted or guessed.
 */
/** A verified proof reduced to the two facts an announcement quotes. */
export interface AnnouncedProof {
    did: string;
    artifactUrl: string;
    commit: string;
}
export interface RoomAnnouncement {
    /** What was published; an absolute HTTPS URL, or omitted. */
    artifactUrl?: string | undefined;
    /** One sentence on what it does. */
    summary: string;
}
export interface PostAnnouncement {
    /** This agent's public DID, from `didFromPrivateKey`. */
    did: string;
    /** The room the message was published in. */
    room: string;
    /** The sequence number the server returned for that write. */
    seq: number;
    /** Overridden by `proof` when both are given, and cross-checked against it. */
    artifactUrl?: string | undefined;
    /** A proof document, already verified by `announcedProof`. */
    proof?: AnnouncedProof | undefined;
}
/**
 * Verify a proof document and confirm it belongs to this agent.
 *
 * Signature validity alone is not enough to announce something: any key can
 * sign a well-formed proof for any URL, so a proof that verifies may still be
 * someone else's claim about someone else's work. Announcing it under your own
 * DID would misrepresent both. Hence the ownership check.
 */
export declare function announcedProof(proof: Record<string, unknown>, did: string): AnnouncedProof;
/**
 * One line ready for `say`: normalized here so the room never rejects text
 * this kit produced.
 */
export declare function roomAnnouncement(announcement: RoomAnnouncement): string;
/** The multi-line block to paste into a post announcing the contribution. */
export declare function postAnnouncement(announcement: PostAnnouncement): string;
