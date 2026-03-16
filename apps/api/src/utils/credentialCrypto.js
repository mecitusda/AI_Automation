import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey() {
  const secret = process.env.CREDENTIAL_SECRET_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("CREDENTIAL_SECRET_KEY must be set and at least 32 bytes");
  }
  return Buffer.from(secret.slice(0, KEY_LENGTH), "utf8");
}

/**
 * Encrypt plaintext (string or object, will be JSON.stringify'd if object).
 * Returns a single base64 string: iv (12) + authTag (16) + ciphertext.
 * @param {string | object} plaintext
 * @returns {string}
 */
export function encrypt(plaintext) {
  const key = getKey();
  const data = typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypt payload produced by encrypt().
 * @param {string} ciphertext - Base64 string (iv + authTag + ciphertext)
 * @returns {object} Parsed JSON object (credential data)
 */
export function decrypt(ciphertext) {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid credential ciphertext");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const data = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  try {
    return JSON.parse(data);
  } catch {
    return { value: data };
  }
}
