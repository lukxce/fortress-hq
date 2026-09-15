import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Refresh tokens are long-lived credentials that can read and
// write real ad accounts; they never sit in the database in plaintext.
const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32"
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes of hex (64 characters); got ${buf.length} bytes.`
    );
  }
  return buf;
}

/** iv:tag:ciphertext, all base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Malformed ciphertext");
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function encryptionReady(): boolean {
  try { key(); return true; } catch { return false; }
}
