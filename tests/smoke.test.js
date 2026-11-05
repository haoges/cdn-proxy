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
