import type { Project } from "./types";

export interface SavedSong {
  id: string;
  name: string;
  updatedAt: string;
  project: Project;
}

const DATABASE_NAME = "garageband-web-songs";
const DATABASE_VERSION = 1;
const STORE_NAME = "songs";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = createRequest(transaction.objectStore(STORE_NAME));
    let result: T;

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function listSavedSongs(): Promise<SavedSong[]> {
  const songs = await runRequest<SavedSong[]>("readonly", (store) =>
    store.getAll() as IDBRequest<SavedSong[]>
  );
  return songs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSavedSong(id: string): Promise<SavedSong | undefined> {
  return runRequest<SavedSong | undefined>("readonly", (store) =>
    store.get(id) as IDBRequest<SavedSong | undefined>
  );
}

export async function saveSong(project: Project): Promise<SavedSong> {
  const id = project.id ?? crypto.randomUUID();
  const savedSong: SavedSong = {
    id,
    name: project.name,
    updatedAt: new Date().toISOString(),
    project: { ...project, id },
  };
  await runRequest("readwrite", (store) => store.put(savedSong));
  return savedSong;
}

export function deleteSavedSong(id: string): Promise<undefined> {
  return runRequest("readwrite", (store) => store.delete(id));
}
