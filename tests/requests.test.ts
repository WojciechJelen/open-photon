import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import { callApi, onApiWrite } from "../src/shared/requests.ts";

const half = '{"characters":[{"id":"a"';

// A real server, so `fetch` fails the way it does in a browser: the status and half a body, then
// the rest never comes (`/stall`) or the connection goes (`/drop`).
const server = createServer((request, response) => {
  if (request.url === "/whole") {
    response.writeHead(200, { "Content-Type": "application/json" }).end('{"wrong":true}');
  } else if (request.url === "/empty") {
    response.writeHead(204).end();
  } else if (request.url === "/page") {
    response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html>");
  } else if (request.url === "/refused") {
    response.writeHead(500, { "Content-Type": "application/json" }).write(half);
    setTimeout(() => response.destroy(), 20);
  } else {
    response.writeHead(200, { "Content-Type": "application/json" }).write(half);

    if (request.url === "/drop") {
      setTimeout(() => response.destroy(), 20);
    }
  }
});

await new Promise<void>((listening) => {
  server.listen(0, "127.0.0.1", listening);
});

// SAFETY: a server listening on a port, not a pipe, has an `AddressInfo` for an address.
const { port } = server.address() as AddressInfo;
const origin = `http://127.0.0.1:${port}`;
const schema = z.object({ characters: z.array(z.object({ id: z.string() })) });

after(() => {
  server.closeAllConnections();
  server.close();
});

/** Aborted once the status has arrived, so the read is cut off inside the body. */
function abortInBody() {
  const controller = new AbortController();

  void sleep(50).then(() => controller.abort());

  return controller.signal;
}

test("a read aborted inside its body is a refusal, as an aborted request is, not a ZodError", async () => {
  const signal = abortInBody();
  const answer = await callApi(schema, `${origin}/stall`, { signal });

  assert.equal(signal.aborted, true);
  assert.ok("refusal" in answer);
});

test("a connection dropped inside a body is a refusal", async () => {
  const answer = await callApi(schema, `${origin}/drop`, {});

  assert.ok("refusal" in answer);
  assert.match(answer.refusal.message, /did not reach the server/);
});

test("a refused answer cut off inside its body keeps its status", async () => {
  const answer = await callApi(schema, `${origin}/refused`, {});

  assert.ok("refusal" in answer);
  assert.match(answer.refusal.message, /\(500\)/);
});

test("a write the server accepted tells its listeners, even if its answer is cut off", async () => {
  let told = 0;

  const unsubscribe = onApiWrite(() => {
    told += 1;
  });

  const answer = await callApi(schema, `${origin}/drop`, { method: "POST" });

  unsubscribe();
  assert.ok("refusal" in answer);
  assert.equal(told, 1);
});

test("a whole body the schema rejects still throws: that is a bug, not a lost connection", async () => {
  await assert.rejects(callApi(schema, `${origin}/whole`, {}), z.ZodError);
  await assert.rejects(callApi(schema, `${origin}/page`, {}), z.ZodError);
});

test("no body, or one that is not JSON, still reads as null", async () => {
  assert.deepEqual(await callApi(z.null(), `${origin}/empty`, { method: "POST" }), { data: null });
  assert.deepEqual(await callApi(z.null(), `${origin}/page`, {}), { data: null });
});
