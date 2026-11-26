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

export async function saveImportedSoundFont(
  fileName: string,
  bytes: ArrayBuffer,
  presets: Omit<ImportedSoundFontPreset, "fileId" | "fileName">[],
  id = crypto.randomUUID(),
): Promise<ImportedSoundFontRecord> {
  const database = await openDatabase();
  const record: StoredImportedSoundFont = {
    id,
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
