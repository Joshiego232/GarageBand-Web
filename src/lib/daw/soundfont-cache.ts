import type { ImportedSoundFontPreset } from "./soundfont-catalog";

const DATABASE_NAME = "webband-soundfonts";
const DATABASE_VERSION = 1;
const REMOTE_STORE = "remote-assets";
const IMPORT_STORE = "imported-banks";

export interface ImportedSoundFontRecord {
  id: string;
  fileName: string;
  createdAt: number;
  presets: Omit<ImportedSoundFontPreset, "fileId" | "fileName">[];
}

interface StoredImportedSoundFont extends ImportedSoundFontRecord {
  bytes: ArrayBuffer;
}

interface StoredRemoteAsset {
  url: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REMOTE_STORE)) {
        database.createObjectStore(REMOTE_STORE, { keyPath: "url" });
      }
      if (!database.objectStoreNames.contains(IMPORT_STORE)) {
        database.createObjectStore(IMPORT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the SoundFont cache."));
    request.onblocked = () => reject(new Error("The SoundFont cache is blocked by another tab."));
  });
}

function requestValue<T>(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  requestFactory: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = requestFactory(transaction.objectStore(storeName));
    let result: T;
    let receivedResult = false;
    request.onsuccess = () => {
      result = request.result;
      receivedResult = true;
    };
    request.onerror = () => reject(request.error ?? new Error("SoundFont cache request failed."));
    transaction.oncomplete = () => {
      if (receivedResult) resolve(result);
      else reject(new Error("SoundFont cache transaction completed without a result."));
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("SoundFont cache transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("SoundFont cache transaction aborted."));
  });
}

export async function getCachedSoundFont(url: string): Promise<ArrayBuffer | undefined> {
  const database = await openDatabase();
  try {
    const asset = await requestValue<StoredRemoteAsset | undefined>(
      database,
      REMOTE_STORE,
      "readonly",
      (store) => store.get(url),
    );
    return asset?.bytes;
  } finally {
    database.close();
  }
}

export async function cacheSoundFont(url: string, bytes: ArrayBuffer): Promise<void> {
  const database = await openDatabase();
  try {
    await requestValue<IDBValidKey>(
      database,
      REMOTE_STORE,
      "readwrite",
      (store) => store.put({ url, bytes, savedAt: Date.now() } satisfies StoredRemoteAsset),
    );
  } finally {
    database.close();
  }
}

function isValidSoundFontFile(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 12) return false;
  const header = new DataView(bytes);
  const readTag = (offset: number) =>
    String.fromCharCode(
      header.getUint8(offset),
      header.getUint8(offset + 1),
      header.getUint8(offset + 2),
      header.getUint8(offset + 3),
    );
  return readTag(0) === "RIFF" && readTag(8) === "sfbk";
}

export interface InstalledSoundFontFile {
  byteLength: number;
  fromCache: boolean;
}

/**
 * Download one complete SF2/SF3 bank, validate its RIFF/SFBK header, and
 * persist it before reporting success. A bad cached entry is automatically
 * replaced by a fresh download.
 */
export async function installSoundFontFile(
  url: string,
  timeoutMs = 45_000,
): Promise<InstalledSoundFontFile> {
  let cached: ArrayBuffer | undefined;
  try {
    cached = await getCachedSoundFont(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error("Local SoundFont storage could not be opened: " + detail);
  }

  if (cached && isValidSoundFontFile(cached)) {
    return { byteLength: cached.byteLength, fromCache: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status} ${response.statusText}).`);
    }

    const bytes = await response.arrayBuffer();
    if (!isValidSoundFontFile(bytes)) {
      throw new Error("The server response is not a valid SF2/SF3 SoundFont bank.");
    }

    await cacheSoundFont(url, bytes);
    return { byteLength: bytes.byteLength, fromCache: false };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Download timed out after " + Math.round(timeoutMs / 1000) + " seconds.");
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveImportedSoundFont(
  fileName: string,
  bytes: ArrayBuffer,
  presets: Omit<ImportedSoundFontPreset, "fileId" | "fileName">[],
): Promise<ImportedSoundFontRecord> {
  const database = await openDatabase();
  const record: StoredImportedSoundFont = {
    id: crypto.randomUUID(),
    fileName,
    createdAt: Date.now(),
    presets,
    bytes,
  };
  try {
    await requestValue<IDBValidKey>(
      database,
      IMPORT_STORE,
      "readwrite",
      (store) => store.put(record),
    );
    const { bytes: _bytes, ...metadata } = record;
    return metadata;
  } finally {
    database.close();
  }
}

export async function listImportedSoundFonts(): Promise<ImportedSoundFontRecord[]> {
  const database = await openDatabase();
  try {
    const records = await requestValue<StoredImportedSoundFont[]>(
      database,
      IMPORT_STORE,
      "readonly",
      (store) => store.getAll(),
    );
    return records.map(({ bytes: _bytes, ...metadata }) => metadata);
  } finally {
    database.close();
  }
}

export async function getImportedSoundFont(fileId: string): Promise<StoredImportedSoundFont | undefined> {
  const database = await openDatabase();
  try {
    return await requestValue<StoredImportedSoundFont | undefined>(
      database,
      IMPORT_STORE,
      "readonly",
      (store) => store.get(fileId),
    );
  } finally {
    database.close();
  }
}
