import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

// AES-256-GCM encryption helpers for at-rest secrets like the IndiaMART
// Pull API key. The master key is a 32-byte hex string in
// `INTEGRATION_ENCRYPTION_KEY` (generate via `openssl rand -hex 32`).
//
// GCM is authenticated encryption — the `tag` returned during encrypt must
// be passed back at decrypt time. All three output fields (ciphertext, iv,
// tag) are base64-encoded for safe storage as TEXT columns and map 1:1 to
// the `IntegrationCredential.apiKey{Ciphertext,Iv,Tag}` columns.

const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits — GCM's recommended IV size

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

function loadMasterKey(): Buffer {
  const hex = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY missing — generate 32 random bytes (hex) and add to .env',
    );
  }
  const key = Buffer.from(hex.trim(), 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): EncryptedPayload {
  const key = loadMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv) as CipherGCM;
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = loadMasterKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
