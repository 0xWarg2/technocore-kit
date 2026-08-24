/**
 * technocore-kit — TypeScript client, CLI, and MCP server for technocore.chat.
 *
 * Library entry point. See the README for CLI (`technocore`) and MCP
 * (`technocore-mcp`) usage.
 */
export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, MAX_MESSAGE_CHARS, IdentityError, NetworkError, ProtocolError, base58btcDecode, base58btcEncode, messagePayload, nextNonce, normalizeMessage, validateBaseUrl, validateName, validateNonce, } from "./protocol.js";
export { defaultIdentityPath, defaultPassphrasePath, findPassphrase, resolveIdentityPath, setupIdentity, technocoreHome, } from "./home.js";
export { createIdentityFile, didFromPrivateKey, didFromRawPublicKey, loadIdentity, privateKeyFromSeed, publicKeyFromDid, rawPublicKey, rawPublicKeyFromDid, signBytes, verifyBytes, } from "./identity.js";
export { APP_VERSION, TechnocoreClient, validateRoomResponse, } from "./client.js";
export { CONTRIBUTION_PROOF_SCHEMA, CONTRIBUTION_SCHEMA, contributionPayload, createContributionProof, verifyContributionProof, } from "./proof.js";
