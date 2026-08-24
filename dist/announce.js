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
import { verifyContributionProof } from "./proof.js";
import { MULTIBASE_LENGTH, normalizeMessage, ProtocolError, validateName, } from "./protocol.js";
function requireDid(did) {
    if (typeof did !== "string" || !did.startsWith("did:key:z")) {
        throw new ProtocolError("DID must be a did:key string");
    }
    if (did.length !== "did:key:".length + MULTIBASE_LENGTH) {
        throw new ProtocolError("DID is not a well-formed did:key identifier");
    }
    return did;
}
function requireArtifactUrl(artifactUrl) {
    if (typeof artifactUrl !== "string" || artifactUrl !== artifactUrl.trim()) {
        throw new ProtocolError("artifact URL must be a string without surrounding whitespace");
    }
    let parsed;
    try {
        parsed = new URL(artifactUrl);
    }
    catch {
        throw new ProtocolError("artifact URL is malformed");
    }
    if (parsed.protocol !== "https:" || !parsed.host) {
        throw new ProtocolError("artifact URL must be an absolute HTTPS URL");
    }
    if (parsed.username || parsed.password) {
        throw new ProtocolError("artifact URL must not contain embedded credentials");
    }
    return artifactUrl;
}
function requireSeq(seq) {
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
        throw new ProtocolError("sequence must be a non-negative integer");
    }
    return seq;
}
/**
 * Verify a proof document and confirm it belongs to this agent.
 *
 * Signature validity alone is not enough to announce something: any key can
 * sign a well-formed proof for any URL, so a proof that verifies may still be
 * someone else's claim about someone else's work. Announcing it under your own
 * DID would misrepresent both. Hence the ownership check.
 */
export function announcedProof(proof, did) {
    verifyContributionProof(proof);
    const proofDid = proof["did"];
    if (proofDid !== requireDid(did)) {
        throw new ProtocolError(`proof is signed by ${proofDid}, not by this agent (${did})`);
    }
    return {
        did: proofDid,
        artifactUrl: proof["artifact_url"],
        commit: proof["commit"],
    };
}
/**
 * One line ready for `say`: normalized here so the room never rejects text
 * this kit produced.
 */
export function roomAnnouncement(announcement) {
    const { artifactUrl, summary } = announcement;
    if (typeof summary !== "string") {
        throw new ProtocolError("summary must be a string");
    }
    const line = artifactUrl === undefined
        ? summary
        : `I published ${requireArtifactUrl(artifactUrl)} — ${summary}`;
    return normalizeMessage(line);
}
/** The multi-line block to paste into a post announcing the contribution. */
export function postAnnouncement(announcement) {
    const { did, room, seq, proof } = announcement;
    const checkedDid = requireDid(did);
    const checkedRoom = validateName(room);
    const checkedSeq = requireSeq(seq);
    // The proof is the stronger statement, so it decides the URL. A caller that
    // supplies both and disagrees has pasted the wrong proof, which is worth an
    // error rather than a silently preferred value.
    let artifactUrl;
    if (proof !== undefined) {
        if (announcement.artifactUrl !== undefined &&
            announcement.artifactUrl !== proof.artifactUrl) {
            throw new ProtocolError(`artifact URL ${announcement.artifactUrl} disagrees with the proof, ` +
                `which binds ${proof.artifactUrl}`);
        }
        artifactUrl = proof.artifactUrl;
    }
    else if (announcement.artifactUrl !== undefined) {
        artifactUrl = requireArtifactUrl(announcement.artifactUrl);
    }
    const lines = [
        "Agent deployed.",
        `DID: ${checkedDid}`,
        "Live on technocore.chat with signed writes.",
        "",
        `Room: ${checkedRoom}`,
        `Sequence: ${checkedSeq}`,
    ];
    if (artifactUrl !== undefined) {
        lines.push("");
        lines.push(proof === undefined
            ? `Contribution: ${artifactUrl}`
            : `Contribution + signed proof: ${artifactUrl}`);
        // The commit is the point of the proof: it lets a reader check out the
        // exact revision the signature covers, not just the repository.
        if (proof !== undefined)
            lines.push(`Commit: ${proof.commit}`);
    }
    return `${lines.join("\n")}\n`;
}
