import type { Project } from "./types";
import { createProjectPreview } from "./project-preview";

export interface SavedSong {
  id: string;
  name: string;
  updatedAt: string;
  createdAt?: string;
  lastOpenedAt?: string;
  preview?: string;
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
  return songs.sort((a, b) =>
    (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt),
  );
}

export function getSavedSong(id: string): Promise<SavedSong | undefined> {
  return runRequest<SavedSong | undefined>("readonly", (store) =>
    store.get(id) as IDBRequest<SavedSong | undefined>
  );
}

export async function saveSong(project: Project): Promise<SavedSong> {
  const id = project.id ?? crypto.randomUUID();
  const existing = await getSavedSong(id);
  const now = new Date().toISOString();
  const savedSong: SavedSong = {
    id,
    name: project.name,
    updatedAt: now,
    createdAt: existing?.createdAt ?? existing?.updatedAt ?? now,
    lastOpenedAt: existing?.lastOpenedAt,
    preview: createProjectPreview(project),
    project: { ...project, id },
  };
  await runRequest("readwrite", (store) => store.put(savedSong));
  return savedSong;
}

export async function markSavedSongOpened(id: string): Promise<SavedSong | undefined> {
  const song = await getSavedSong(id);
  if (!song) return undefined;
  const opened = { ...song, lastOpenedAt: new Date().toISOString() };
  await runRequest("readwrite", (store) => store.put(opened));
  return opened;
}

export function deleteSavedSong(id: string): Promise<undefined> {
  return runRequest("readwrite", (store) => store.delete(id));
}
