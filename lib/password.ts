import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

// Stored as "<salt hex>:<key hex>".
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

// Returns the cleaned input, or the message to show the user.
export function parseSignUp(input: SignUpInput): { ok: true; value: SignUpInput } | { ok: false; error: string } {
  const name = String(input?.name ?? "").trim();
  const email = String(input?.email ?? "").trim().toLowerCase();
  const password = String(input?.password ?? "");
  if (!name) return { ok: false, error: "Enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  return { ok: true, value: { name, email, password } };
}
