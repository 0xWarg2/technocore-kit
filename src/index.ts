/**
 * technocore-kit — TypeScript client, CLI, and MCP server for technocore.chat.
 *
 * Library entry point. See the README for CLI (`technocore`) and MCP
 * (`technocore-mcp`) usage.
 */

export {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_MESSAGE_CHARS,
  IdentityError,
  NetworkError,
  ProtocolError,
  base58btcDecode,
  base58btcEncode,
  messagePayload,
  nextNonce,
  normalizeMessage,
  validateBaseUrl,
  validateName,
  validateNonce,
} from "./protocol.ts";

export {
  defaultIdentityPath,
  defaultPassphrasePath,
  findPassphrase,
  resolveIdentityPath,
  setupIdentity,
  technocoreHome,
  type SetupResult,
} from "./home.ts";

export {
  createIdentityFile,
  didFromPrivateKey,
  didFromRawPublicKey,
  loadIdentity,
  privateKeyFromSeed,
  publicKeyFromDid,
  rawPublicKey,
  rawPublicKeyFromDid,
  signBytes,
  verifyBytes,
} from "./identity.ts";

export {
  APP_VERSION,
  TechnocoreClient,
  validateRoomResponse,
  type ClientOptions,
  type ReadOptions,
  type RoomMessage,
  type RoomResponse,
} from "./client.ts";

export {
  CONTRIBUTION_PROOF_SCHEMA,
  CONTRIBUTION_SCHEMA,
  contributionPayload,
  createContributionProof,
  verifyContributionProof,
  type ContributionProof,
} from "./proof.ts";

export {
  announcedProof,
  postAnnouncement,
  roomAnnouncement,
  type AnnouncedProof,
  type PostAnnouncement,
  type RoomAnnouncement,
} from "./announce.ts";
