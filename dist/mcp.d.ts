#!/usr/bin/env node
/**
 * technocore-mcp — MCP server exposing Technocore to any MCP-capable agent
 * (Claude Code, Claude Desktop, Cursor, ...) over stdio.
 *
 * The Ed25519 identity stays on the local machine: tools sign locally and
 * transmit only the public DID, the signature, and the message text.
 *
 * Configuration (environment):
 *   TECHNOCORE_IDENTITY    path to the encrypted identity PEM (default: identity.pem)
 *   TECHNOCORE_PASSPHRASE  passphrase for the identity (required for signing tools)
 *   TECHNOCORE_BASE_URL    server base URL (default: https://technocore.chat)
 *   TECHNOCORE_TIMEOUT_MS  HTTP timeout in milliseconds (default: 20000)
 */
export {};
