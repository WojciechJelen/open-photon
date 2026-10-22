import "../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createAccessPolicy } from "./access-policy.ts";
import { findAsset } from "./assets.ts";
import { database } from "./db.server.ts";

const sampleAsset = () =>
  String(database.prepare("SELECT id FROM assets WHERE role = 'sample' LIMIT 1").get()?.id);

test("with no declarations everything is private but the server-function door", () => {
  const policy = createAccessPolicy([]);

  assert.equal(policy.isPublicRequest("GET", "/"), false);
  assert.equal(policy.isPublicRequest("GET", `/media/${sampleAsset()}.png`), false);
  assert.equal(policy.isPublicRequest("POST", "/_serverFn/anything"), true);
  assert.equal(policy.isPublicServerFn("src/features/x/a.functions.ts#load"), false);
  assert.equal(policy.isIndexable("/r/slug"), false);
});

test("declarations compose: routes by method and alias, `when`, assets, server functions, indexing", () => {
  const policy = createAccessPolicy([
    {
      indexableRoutes: [/^\/r\/[^/]+$/i],
      isPublicAsset: (asset) => asset.role === "sample",
      publicRoutes: [
        { method: "GET", pattern: /^\/tool$/i },
        { method: "GET", pattern: /^\/items\/(\w+)$/i, when: (match) => match[1] === "open" },
      ],
    },
    {
      isIndexableAsset: (asset) => asset.role === "sample",
      publicRoutes: [{ method: "POST", pattern: /^\/api\/act$/i }],
      publicServerFns: { "src/features/x/a.functions.ts#load": true },
    },
  ]);

  const sample = sampleAsset();

  assert.ok(findAsset(sample));
  assert.equal(policy.isPublicRequest("GET", "/TOOL/"), true);
  assert.equal(policy.isPublicRequest("HEAD", "/tool"), true);
  assert.equal(policy.isPublicRequest("POST", "/tool"), false);
  assert.equal(policy.isPublicRequest("DELETE", "/api/act"), false);
  assert.equal(policy.isPublicRequest("POST", "/api/act"), true);
  assert.equal(policy.isPublicRequest("GET", "/api/act"), false);
  assert.equal(policy.isPublicRequest("GET", "/items/open"), true);
  assert.equal(policy.isPublicRequest("GET", "/items/shut"), false);
  assert.equal(policy.isPublicRequest("GET", `/media/${sample}.png`), true);
  assert.equal(policy.isPublicRequest("POST", `/media/${sample}.png`), false);
  assert.equal(policy.isPublicRequest("GET", `/media/${randomUUID()}.png`), false);
  assert.equal(policy.isPublicAsset(sample), true);
  assert.equal(policy.isPublicServerFn("src/features/x/a.functions.ts#load"), true);
  assert.equal(policy.isIndexable("/r/slug/"), true);
  assert.equal(policy.isIndexable(`/media/${sample}.png`), true);
  assert.equal(policy.isIndexable("/tool"), false);
});
