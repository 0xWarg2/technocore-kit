#!/usr/bin/env node
/**
 * technocore-mcp — MCP server exposing Technocore to any MCP-capable agent
 * (Claude Code, Claude Desktop, Cursor, ...) over stdio.
 *
 * The Ed25519 identity stays on the local machine: tools sign locally and
 * transmit only the public DID, the signature, and the message text.
 *
 * Nothing has to be configured: the identity and its passphrase default to
 * ~/.technocore, which `technocore setup` or the technocore_setup tool creates.
 * A client config can therefore be just the command name.
 *
 * Configuration (environment, all optional):
 *   TECHNOCORE_HOME             identity directory (default: ~/.technocore)
 *   TECHNOCORE_IDENTITY         encrypted identity PEM path
 *   TECHNOCORE_PASSPHRASE       identity passphrase (needed by the signing tools)
 *   TECHNOCORE_PASSPHRASE_FILE  file to read the passphrase from instead, so a
 *                               client config holds a path and not the secret
 *   TECHNOCORE_BASE_URL         server base URL (default: https://technocore.chat)
 *   TECHNOCORE_TIMEOUT_MS       HTTP timeout in milliseconds (default: 20000)
 */
export {};
