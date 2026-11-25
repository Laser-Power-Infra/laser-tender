import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, parseSignUp, verifyPassword } from "./password";

test("verifyPassword accepts the right password and rejects a wrong one", async () => {
  const hash = await hashPassword("correct horse");
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("wrong horse", hash), false);
});

test("hashPassword salts: same password gives different hashes, and no plaintext", async () => {
  const a = await hashPassword("correct horse");
  const b = await hashPassword("correct horse");
  assert.notEqual(a, b);
  assert.ok(!a.includes("correct horse"));
});

test("verifyPassword returns false for a malformed stored hash", async () => {
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "nocolon"), false);
  assert.equal(await verifyPassword("x", "abcd:abcd"), false);
});

test("parseSignUp trims, lowercases the email and validates", () => {
  assert.deepEqual(parseSignUp({ name: " Asha ", email: " Asha@Example.COM ", password: "12345678" }), {
    ok: true,
    value: { name: "Asha", email: "asha@example.com", password: "12345678" },
  });
  assert.equal(parseSignUp({ name: "A", email: "not-an-email", password: "12345678" }).ok, false);
  assert.equal(parseSignUp({ name: "A", email: "a@b.co", password: "1234567" }).ok, false);
  assert.equal(parseSignUp({ name: " ", email: "a@b.co", password: "12345678" }).ok, false);
});
