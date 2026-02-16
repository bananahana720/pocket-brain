import { Note } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_DB_NAME = 'pocketbrain_crypto';
const KEY_DB_VERSION = 1;
const KEY_STORE = 'keys';
const LEGACY_AUTO_BACKUP_KEY_ID = 'auto_backup_key_v1';
const AUTO_BACKUP_KEY_ID_PREFIX = 'auto_backup_key_v1';
const AUTO_BACKUP_ANON_SCOPE = '__anon__';

interface AutoBackupKeyRecord {
  id: string;
  key: CryptoKey;
  createdAt: number;
}

function normalizeAutoBackupScope(scopeId: string | null | undefined): string {
  if (typeof scopeId !== 'string') {
    return AUTO_BACKUP_ANON_SCOPE;
  }

  const trimmed = scopeId.trim();
  if (!trimmed) {
    return AUTO_BACKUP_ANON_SCOPE;
  }

  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized || AUTO_BACKUP_ANON_SCOPE;
}

function resolveAutoBackupKeyId(scopeId: string | null | undefined): string {
  return `${AUTO_BACKUP_KEY_ID_PREFIX}:${normalizeAutoBackupScope(scopeId)}`;
}

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

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open backup key store'));
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

async function loadAutoBackupKeyRecord(scopeId: string | null = null): Promise<AutoBackupKeyRecord | null> {
  const scopedId = resolveAutoBackupKeyId(scopeId);
  const db = await openKeyDb();
  try {
    const tx = db.transaction(KEY_STORE, 'readonly');
    const store = tx.objectStore(KEY_STORE);
    const record = (await promisifyRequest(store.get(scopedId))) as AutoBackupKeyRecord | undefined;
    if (!record || !(record.key instanceof CryptoKey)) return null;
    return {
      ...record,
      id: scopedId,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function saveAutoBackupKeyRecord(record: AutoBackupKeyRecord, scopeId: string | null = null): Promise<void> {
  const id = resolveAutoBackupKeyId(scopeId);
  const db = await openKeyDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).put({
        ...record,
        id,
      } satisfies AutoBackupKeyRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to save backup key'));
      tx.onabort = () => reject(tx.error || new Error('Backup key save aborted'));
    });
  } finally {
    db.close();
  }
}

export async function clearAutoBackupKey(scopeId: string | null = null): Promise<void> {
  const scopedId = resolveAutoBackupKeyId(scopeId);
  const normalizedScope = normalizeAutoBackupScope(scopeId);
  const db = await openKeyDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).delete(scopedId);
      if (normalizedScope === AUTO_BACKUP_ANON_SCOPE) {
        tx.objectStore(KEY_STORE).delete(LEGACY_AUTO_BACKUP_KEY_ID);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear backup key'));
      tx.onabort = () => reject(tx.error || new Error('Backup key clear aborted'));
    });
  } finally {
    db.close();
  }
}

export async function getOrCreateAutoBackupKey(scopeId: string | null = null): Promise<CryptoKey> {
  const scopedId = resolveAutoBackupKeyId(scopeId);
  const existing = await loadAutoBackupKeyRecord(scopeId);
  if (existing) {
    if (existing.id !== scopedId) {
      await saveAutoBackupKeyRecord(
        {
          ...existing,
          id: scopedId,
        },
        scopeId
      );
    }
    return existing.key;
  }

  let legacyKeyRecord: AutoBackupKeyRecord | null = null;
  const db = await openKeyDb();
  try {
    const tx = db.transaction(KEY_STORE, 'readonly');
    const legacyRecord = (await promisifyRequest(tx.objectStore(KEY_STORE).get(LEGACY_AUTO_BACKUP_KEY_ID))) as
      | AutoBackupKeyRecord
      | undefined;
    if (legacyRecord && legacyRecord.key instanceof CryptoKey) {
      legacyKeyRecord = legacyRecord;
    }
  } finally {
    db.close();
  }

  if (legacyKeyRecord) {
    await saveAutoBackupKeyRecord(
      {
        ...legacyKeyRecord,
        id: scopedId,
      },
      scopeId
    );
    return legacyKeyRecord.key;
  }

  const key = await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );

  await saveAutoBackupKeyRecord(
    {
      id: resolveAutoBackupKeyId(scopeId),
      key,
      createdAt: Date.now(),
    },
    scopeId
  );

  return key;
}

export async function createEncryptedBackupPayloadWithKey(
  notes: Note[],
  key: CryptoKey,
  options?: { keyScopeId?: string | null }
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(notes));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    plaintext
  );

  return JSON.stringify(
    {
      version: 2,
      algorithm: 'AES-GCM',
      kdf: 'IDB_KEY',
      keyRef: resolveAutoBackupKeyId(options?.keyScopeId),
      iv: toBase64(iv),
      ciphertext: toBase64(fromBuffer(ciphertext)),
      createdAt: new Date().toISOString(),
    },
    null,
    2
  );
}

export async function parseEncryptedBackupPayloadWithKey(payload: string, key: CryptoKey): Promise<Note[]> {
  const data = JSON.parse(payload) as {
    iv: string;
    ciphertext: string;
  };

  const iv = Uint8Array.from(atob(data.iv), char => char.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(data.ciphertext), char => char.charCodeAt(0));
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
