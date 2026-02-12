import { Note } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 120000,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBuffer(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

export async function createEncryptedBackupPayload(
  notes: Note[],
  passphrase: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = encoder.encode(JSON.stringify(notes));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    plaintext
  );

  const payload = {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 120000,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(fromBuffer(ciphertext)),
    createdAt: new Date().toISOString(),
  };

  return JSON.stringify(payload, null, 2);
}

export async function parseEncryptedBackupPayload(
  payload: string,
  passphrase: string
): Promise<Note[]> {
  const data = JSON.parse(payload) as {
    salt: string;
    iv: string;
    ciphertext: string;
  };

  const salt = Uint8Array.from(atob(data.salt), char => char.charCodeAt(0));
  const iv = Uint8Array.from(atob(data.iv), char => char.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(data.ciphertext), char => char.charCodeAt(0));

  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    ciphertext
  );

  return JSON.parse(decoder.decode(plaintext)) as Note[];
}
