import type { Project } from "./types";
import { getSupabaseClient, type Json } from "../supabase";
import { decodeStoredBuffer, encodeStoredBuffer } from "./cloud-audio";
import type { StoredBuffer } from "./idb";
import type { ImportedSoundFontPreset } from "./soundfont-catalog";
import { createProjectPreview } from "./project-preview";

const AUDIO_BUCKET = "project-audio";

export interface CloudSavedSong {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  lastOpenedAt: string | null;
  preview: string;
  project: Project;
  assets: Record<string, string>;
}

function isProject(value: unknown): value is Project {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("tempo" in value) ||
    typeof value.tempo !== "number" ||
    !("timeSig" in value) ||
    !Array.isArray(value.timeSig) ||
    value.timeSig.length !== 2 ||
    !value.timeSig.every((part) => typeof part === "number") ||
    !("tracks" in value) ||
    !Array.isArray(value.tracks)
  ) {
    return false;
  }
  return true;
}

function parseProject(value: Json): Project {
  if (!isProject(value)) throw new Error("A cloud project has invalid project data");
  return value;
}

function toJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Project contains an invalid number");
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, field]) => field !== undefined)
        .map(([key, field]) => [key, toJson(field)]),
    );
  }
  throw new Error("Project contains unsupported data");
}

function parseAssets(value: Json): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A cloud project has invalid audio references");
  }

  const assets: Record<string, string> = {};
  for (const [bufferId, path] of Object.entries(value)) {
    if (typeof path !== "string") {
      throw new Error("A cloud project has an invalid audio reference");
    }
    assets[bufferId] = path;
  }
  return assets;
}

function projectMediaReferences(project: Project): {
  bufferIds: string[];
  soundFontIds: string[];
} {
  const bufferIds = new Set<string>();
  const soundFontIds = new Set<string>();
  for (const track of project.tracks) {
    if (track.sampleBufferId) bufferIds.add(track.sampleBufferId);
    for (const zone of track.sampleZones ?? []) bufferIds.add(zone.bufferId);
    if (track.soundFontPreset?.fileId) soundFontIds.add(track.soundFontPreset.fileId);
    for (const region of track.regions) {
      for (const id of [
        region.bufferId,
        region.originalAudioBufferId,
        region.denoisedAudioBufferId,
      ]) {
        if (id) bufferIds.add(id);
      }
    }
  }
  return { bufferIds: [...bufferIds], soundFontIds: [...soundFontIds] };
}

function bufferPath(userId: string, projectId: string, bufferId: string): string {
  return `${userId}/${encodeURIComponent(projectId)}/${encodeURIComponent(bufferId)}.wba`;
}

async function currentUserId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Cloud projects are not configured");

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in to use cloud projects");
  return data.user.id;
}

async function uploadProjectAudio(
  userId: string,
  project: Project,
): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Cloud projects are not configured");

  const { engine } = await import("./engine");
  const assets: Record<string, string> = {};
  const { bufferIds, soundFontIds } = projectMediaReferences(project);
  for (const bufferId of bufferIds) {
    const buffer = await engine.ensureBufferLoaded(bufferId);
    if (!buffer) {
      throw new Error(
        `Audio data "${bufferId}" is missing from this browser. Re-import it before saving to the cloud.`,
      );
    }
    const path = bufferPath(userId, project.id!, bufferId);
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(path, encodeStoredBuffer(buffer), {
        contentType: "application/octet-stream",
        upsert: true,
      });
    if (error) throw error;
    assets[`buffer:${bufferId}`] = path;
  }

  if (soundFontIds.length) {
    const soundFonts = await import("./soundfont-cache");
    for (const fileId of soundFontIds) {
      const soundFont = await soundFonts.getImportedSoundFont(fileId);
      if (!soundFont) {
        throw new Error(
          `Imported SoundFont "${fileId}" is missing from this browser. Re-import it before saving to the cloud.`,
        );
      }

      const path = `${userId}/${encodeURIComponent(project.id!)}/soundfont-${encodeURIComponent(fileId)}.sf`;
      const { error } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(path, new Blob([soundFont.bytes]), {
          contentType: "application/octet-stream",
          upsert: true,
        });
      if (error) throw error;
      assets[`soundfont:${fileId}`] = path;
      assets[`soundfont-metadata:${fileId}`] = JSON.stringify({
        fileName: soundFont.fileName,
        presets: soundFont.presets,
      });
    }
  }
  return assets;
}

export async function saveCloudProject(project: Project): Promise<CloudSavedSong> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Cloud projects are not configured");

  const userId = await currentUserId();
  const id = project.id ?? crypto.randomUUID();
  const savedProject = { ...project, id };
  const { data: existing, error: existingError } = await supabase
    .from("saved_projects")
    .select("created_at, last_opened_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw existingError;
  const assets = await uploadProjectAudio(userId, savedProject);
  const updatedAt = new Date().toISOString();
  const createdAt = existing?.created_at ?? updatedAt;
  const lastOpenedAt = existing?.last_opened_at ?? null;
  const preview = createProjectPreview(savedProject);
  const { error } = await supabase.from("saved_projects").upsert({
    id,
    user_id: userId,
    name: savedProject.name,
    project: toJson(savedProject),
    assets,
    updated_at: updatedAt,
    created_at: createdAt,
    last_opened_at: lastOpenedAt,
    preview,
  });
  if (error) throw error;

  return {
    id,
    name: savedProject.name,
    updatedAt,
    createdAt,
    lastOpenedAt,
    preview,
    project: savedProject,
    assets,
  };
}

export async function saveCloudProjectIfSignedIn(
  project: Project,
): Promise<CloudSavedSong | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  return saveCloudProject(project);
}

export async function listCloudProjects(): Promise<CloudSavedSong[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("saved_projects")
    .select("id, name, project, assets, updated_at, created_at, last_opened_at, preview")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
    preview: row.preview ?? createProjectPreview(parseProject(row.project)),
    project: parseProject(row.project),
    assets: parseAssets(row.assets),
  }));
}

export async function markCloudProjectOpened(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Cloud projects are not configured");

  const userId = await currentUserId();
  const { error } = await supabase
    .from("saved_projects")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function restoreCloudProjectAudio(song: CloudSavedSong): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Cloud projects are not configured");

  const userId = await currentUserId();
  const { engine } = await import("./engine");
  const { bufferIds, soundFontIds } = projectMediaReferences(song.project);
  for (const bufferId of bufferIds) {
    const path = song.assets[`buffer:${bufferId}`];
    if (!path) {
      throw new Error(`Cloud audio for "${bufferId}" is missing`);
    }
    if (!path.startsWith(`${userId}/`)) {
      throw new Error("A cloud project contains an invalid audio location");
    }
    if (await engine.ensureBufferLoaded(bufferId)) continue;

    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(path);
    if (error) throw error;
    const buffer: StoredBuffer = await decodeStoredBuffer(data);
    await engine.storeBuffer(bufferId, buffer);
  }

  const soundFonts = await import("./soundfont-cache");
  for (const fileId of soundFontIds) {
    if (await soundFonts.getImportedSoundFont(fileId)) continue;
    const path = song.assets[`soundfont:${fileId}`];
    const metadata = song.assets[`soundfont-metadata:${fileId}`];
    if (!path || !metadata || !path.startsWith(`${userId}/`)) {
      throw new Error(`Cloud SoundFont "${fileId}" is missing or invalid`);
    }

    const parsed: unknown = JSON.parse(metadata);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("fileName" in parsed) ||
      typeof parsed.fileName !== "string" ||
      !("presets" in parsed) ||
      !Array.isArray(parsed.presets)
    ) {
      throw new Error(`Cloud SoundFont "${fileId}" has invalid metadata`);
    }
    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(path);
    if (error) throw error;
    const presets = parsed.presets as Omit<ImportedSoundFontPreset, "fileId" | "fileName">[];
    await soundFonts.saveImportedSoundFont(
      parsed.fileName,
      await data.arrayBuffer(),
      presets,
      fileId,
    );
  }
}

export async function deleteCloudProject(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Cloud projects are not configured");

  const userId = await currentUserId();
  const { data, error: lookupError } = await supabase
    .from("saved_projects")
    .select("assets")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!data) return;

  const assets = parseAssets(data.assets);
  const paths = Object.entries(assets)
    .filter(([key]) => !key.startsWith("soundfont-metadata:"))
    .map(([, path]) => path);
  if (paths.length) {
    const { error: storageError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .remove(paths);
    if (storageError) throw storageError;
  }

  const { error: deleteError } = await supabase
    .from("saved_projects")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
}
