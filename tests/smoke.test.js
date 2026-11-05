import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../shared/core.js";

test("health endpoint returns JSON", async () => {
  const response = await handleRequest(new Request("https://proxy.test/health"), {}, { name: "test" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.version, "3.0.0");
});

test("homepage returns HTML", async () => {
  const response = await handleRequest(new Request("https://proxy.test/"), {}, { name: "test" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
});

test("private IPv4 targets are rejected", async () => {
  const response = await handleRequest(new Request("https://proxy.test/http://127.0.0.1/"), {}, { name: "test" });
  assert.equal(response.status, 403);
});

test("private IPv6 targets are rejected", async () => {
  const response = await handleRequest(new Request("https://proxy.test/http://[::1]/"), {}, { name: "test" });
  assert.equal(response.status, 403);
});

test("token authentication protects proxy routes", async () => {
  const response = await handleRequest(
    new Request("https://proxy.test/https://example.com/"),
    { PROXY_TOKEN: "test-secret" },
    { name: "test" }
  );
  assert.equal(response.status, 401);
});

test("unsupported protocols are rejected", async () => {
  const response = await handleRequest(new Request("https://proxy.test/ftp://example.com/file"), {}, { name: "test" });
  assert.equal(response.status, 400);
});

test("proxy bearer token is never forwarded to upstream", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamAuthorization = "not-called";
  globalThis.fetch = async (_url, init) => {
    upstreamAuthorization = new Headers(init.headers).get("Authorization");
    return new Response("ok", { status: 200 });
  };
  try {
    const response = await handleRequest(
      new Request("https://proxy.test/https://example.com/", {
        headers: { Authorization: "Bearer test-secret" }
      }),
      { PROXY_TOKEN: "test-secret" },
      { name: "test" }
    );
    assert.equal(response.status, 200);
    assert.equal(upstreamAuthorization, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy route forwards query parameters without relying on iterable APIs", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = new URL(String(url));
    return new Response("ok", { status: 200 });
  };
  try {
    const response = await handleRequest(
      new Request("https://proxy.test/https://example.com/path?a=1&token=should-not-forward&b=2"),
      {},
      { name: "EdgeOne Makers" }
    );
    assert.equal(response.status, 200);
    assert.equal(upstreamUrl.searchParams.get("a"), "1");
    assert.equal(upstreamUrl.searchParams.get("b"), "2");
    assert.equal(upstreamUrl.searchParams.has("token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
