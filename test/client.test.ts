import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import {
  NetworkError,
  TechnocoreClient,
  messagePayload,
  privateKeyFromSeed,
  verifyBytes,
} from "../src/index.ts";

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/vectors.json", import.meta.url), "utf-8"),
);
const privateKey = privateKeyFromSeed(
  Uint8Array.from(Buffer.from(vectors.seed_hex, "hex")),
);

/**
 * Minimal loopback Technocore stand-in that verifies signatures with the
 * same rules as the real server before accepting a write.
 */
let server: Server;
let baseUrl: string;
const rooms = new Map<string, Array<Record<string, unknown>>>();

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = /^\/r\/([a-z0-9][a-z0-9_-]{0,47})$/.exec(url.pathname);
    if (!match) {
      res.writeHead(404).end(JSON.stringify({ error: "no such room" }));
      return;
    }
    const room = match[1] as string;
    const messages = rooms.get(room) ?? [];
    if (req.method === "GET") {
      if (room === "throttled") {
        // \u0007 (BEL) exercises the terminal-safe error sanitizer.
        res.writeHead(429).end("slow\u0007down please");
        return;
      }
      const since = Number(url.searchParams.get("since") ?? 0);
      const visible = messages.filter((m) => (m["seq"] as number) > since);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          room,
          count: messages.length,
          last_seq: messages.length,
          messages: visible,
        }),
      );
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const record = JSON.parse(body) as Record<string, unknown>;
        const { payload } = messagePayload(
          room,
          record["nonce"] as string,
          record["text"] as string,
        );
        try {
          verifyBytes(record["did"] as string, record["sig"] as string, payload);
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: "bad signature" }));
          return;
        }
        const posted = {
          seq: messages.length + 1,
          from:
            room === "impostor"
              ? "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
              : record["did"],
          text: record["text"],
          nonce: record["nonce"],
        };
        messages.push(posted);
        rooms.set(room, messages);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            room,
            count: messages.length,
            last_seq: messages.length,
            messages,
            posted,
          }),
        );
      });
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

test("say signs, posts, and validates the echoed record", async () => {
  const client = new TechnocoreClient({ baseUrl });
  const response = await client.say(privateKey, "lobby", "hello from the kit");
  assert.equal(response.room, "lobby");
  assert.equal(response.posted?.text, "hello from the kit");
  assert.equal(response.posted?.from, vectors.did);
  assert.equal(response.posted?.seq, 1);
});

test("readRoom returns validated room data", async () => {
  const client = new TechnocoreClient({ baseUrl });
  const response = await client.readRoom("lobby");
  assert.equal(response.room, "lobby");
  assert.equal(response.count, 1);
  assert.equal(response.messages[0]?.text, "hello from the kit");
});

test("say rejects a posted record attributed to a different DID", async () => {
  const client = new TechnocoreClient({ baseUrl });
  await assert.rejects(
    client.say(privateKey, "impostor", "who signed this"),
    NetworkError,
  );
});

test("HTTP errors surface status and a terminal-safe body", async () => {
  const client = new TechnocoreClient({ baseUrl });
  await assert.rejects(
    client.readRoom("throttled"),
    (error: unknown) =>
      error instanceof NetworkError &&
      error.message.includes("HTTP 429") &&
      error.message.includes("slow down please") &&
      !error.message.includes("\u0007"),
  );
});

test("long-poll options are validated", async () => {
  const client = new TechnocoreClient({ baseUrl, timeoutMs: 5_000 });
  await assert.rejects(client.readRoom("lobby", { wait: 3 }), /requires a since/);
  await assert.rejects(
    client.readRoom("lobby", { since: 0, wait: 11 }),
    /between 0 and 10/,
  );
  const slowPoll = new TechnocoreClient({ baseUrl, timeoutMs: 2_000 });
  await assert.rejects(
    slowPoll.readRoom("lobby", { since: 0, wait: 5 }),
    /timeout must be greater than wait/,
  );
});
