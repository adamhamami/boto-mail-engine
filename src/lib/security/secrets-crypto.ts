import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Chiffrement applicatif opt-in pour secrets stockés (AppSetting.isSecret).
 * Clé dérivée de AUTH_SECRET (HKDF-like via SHA-256) — pas de KMS externe en V1.
 *
 * SMTP reste hors DB (variables d'environnement).
 * Format : enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 */

const PREFIX = "enc:v1:";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`botoschool-secret-v1:${secret}`).digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string, authSecret: string): string {
  const key = deriveKey(authSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(
  payload: string,
  authSecret: string,
  previousSecret?: string,
): string {
  if (!isEncryptedSecret(payload)) {
    return payload;
  }

  const body = payload.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret format");
  }

  const tryDecrypt = (secret: string): string => {
    const key = deriveKey(secret);
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  };

  try {
    return tryDecrypt(authSecret);
  } catch {
    if (previousSecret) {
      return tryDecrypt(previousSecret);
    }
    throw new Error("Unable to decrypt secret with current or previous key");
  }
}
