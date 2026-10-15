import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

test("hashPassword creates a scrypt hash and verifyPassword accepts the right secret", async () => {
  const encoded = await hashPassword("correct horse battery staple");

  assert.match(encoded, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
});

test("hashPassword uses a fresh salt for each hash", async () => {
  const first = await hashPassword("same-password");
  const second = await hashPassword("same-password");

  assert.notEqual(first, second);
  assert.equal(await verifyPassword("same-password", first), true);
  assert.equal(await verifyPassword("same-password", second), true);
});

test("verifyPassword fails closed on malformed encodings", async () => {
  assert.equal(await verifyPassword("anything", "not-a-supported-hash"), false);
  assert.equal(await verifyPassword("anything", "scrypt$missing-key"), false);
});
