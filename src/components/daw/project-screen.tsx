"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowDownWideNarrow, Cloud, FolderOpen, Loader2, Music2, Plus, Search } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import {
  listCloudProjects,
  markCloudProjectOpened,
  restoreCloudProjectAudio,
  type CloudSavedSong,
} from "@/lib/daw/cloud-projects";
import {
  listSavedSongs,
  markSavedSongOpened,
  type SavedSong,
} from "@/lib/daw/saved-songs";
import { createProjectPreview } from "@/lib/daw/project-preview";

type ProjectEntryFields = {
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string | null;
  preview: string;
};

type ProjectEntry = ProjectEntryFields & (
  | { source: "device"; song: SavedSong }
  | { source: "cloud"; song: CloudSavedSong }
);

type SortOrder = "recent" | "created" | "name";

function dateLabel(value: string | null): string {
  if (!value) return "Not opened yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : format(date, "MMM d, yyyy");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Storage unavailable";
}

export function ProjectScreen({ onCreate }: { onCreate: () => void }) {
  const loadProject = useDAW((state) => state.loadProject);
  const { user, loading: authLoading } = useCloudAuth();
  const [localSongs, setLocalSongs] = useState<SavedSong[] | null>(null);
  const [cloudProjects, setCloudProjects] = useState<{
    userId: string;
    songs: CloudSavedSong[];
  } | null>(null);
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void listSavedSongs()
      .then((songs) => {
        if (active) setLocalSongs(songs);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLocalSongs([]);
        toast.error(`Could not load projects on this device: ${errorText(error)}`);
      });

    if (!user) {
      void Promise.resolve().then(() => {
        if (active) setCloudProjects({ userId: "", songs: [] });
      });
    } else {
      void listCloudProjects()
        .then((songs) => {
          if (active) setCloudProjects({ userId: user.id, songs });
        })
        .catch((error: unknown) => {
          if (!active) return;
          setCloudProjects({ userId: user.id, songs: [] });
          toast.error(`Could not load cloud projects: ${errorText(error)}`);
        });
    }

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const cloudSongs =
    user && cloudProjects?.userId === user.id ? cloudProjects.songs : [];
  const cloudLoading = Boolean(user && cloudProjects?.userId !== user.id);

  const projects = useMemo(() => {
    const cloudIds = new Set(cloudSongs.map((song) => song.id));
    const entries: ProjectEntry[] = [
      ...cloudSongs.map((song) => ({
        id: `cloud:${song.id}`,
        name: song.name,
        createdAt: song.createdAt,
        lastOpenedAt: song.lastOpenedAt,
        preview: song.preview,
        source: "cloud" as const,
        song,
      })),
      ...(localSongs ?? [])
        .filter((song) => !cloudIds.has(song.id))
        .map((song) => ({
          id: `device:${song.id}`,
          name: song.name,
          createdAt: song.createdAt ?? song.updatedAt,
          lastOpenedAt: song.lastOpenedAt ?? null,
          preview: song.preview ?? createProjectPreview(song.project),
          source: "device" as const,
          song,
        })),
    ];
    const filtered = entries.filter((entry) =>
      entry.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    return filtered.sort((a, b) => {
      if (sortOrder === "name") return a.name.localeCompare(b.name);
      const aDate = sortOrder === "created" ? a.createdAt : a.lastOpenedAt;
      const bDate = sortOrder === "created" ? b.createdAt : b.lastOpenedAt;
      return (bDate ?? "").localeCompare(aDate ?? "");
    });
  }, [cloudSongs, localSongs, search, sortOrder]);

  const openProject = async (entry: ProjectEntry) => {
    setOpeningId(entry.id);
    try {
      if (entry.source === "cloud") {
        const song = entry.song;
        await restoreCloudProjectAudio(song);
        loadProject(song.project);
        try {
          await markCloudProjectOpened(song.id);
        } catch (error) {
          toast.error(`Opened the project, but could not update its last-opened date: ${errorText(error)}`);
        }
      } else {
        const song = entry.song;
        loadProject(song.project);
        try {
          const latest = await markSavedSongOpened(song.id);
          if (!latest) throw new Error("Project not found on this device");
        } catch (error) {
          toast.error(`Opened the project, but could not update its last-opened date: ${errorText(error)}`);
        }
      }
      toast.success(`Opened "${entry.name}"`);
    } catch (error) {
      toast.error(`Could not open "${entry.name}": ${errorText(error)}`);
    } finally {
      setOpeningId(null);
    }
  };

  const isLoading = localSongs === null || authLoading || cloudLoading;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#171719] text-zinc-100">
      <div className="mx-auto max-w-6xl px-5 py-9 sm:px-8 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#ffb648]">
              GarageBand Web
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your Projects</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Pick up where you left off, or start something new.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ffb648] px-4 text-sm font-semibold text-[#1d1d20] transition hover:bg-[#ffc167]"
          >
            <Plus size={16} aria-hidden />
            New Project
          </button>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-b border-white/[0.08] pb-4">
          <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-white/[0.08] bg-[#202023] px-3 text-zinc-500 focus-within:border-[#ffb648]/50">
            <Search size={14} aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a project"
              aria-label="Find a project"
              className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </label>
          <label className="flex h-9 items-center gap-2 rounded-md border border-white/[0.08] bg-[#202023] px-3 text-zinc-500">
            <ArrowDownWideNarrow size={14} aria-hidden />
            <span className="sr-only">Sort projects</span>
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as SortOrder)}
              aria-label="Sort projects"
              className="bg-transparent text-xs text-zinc-300 outline-none"
            >
              <option value="recent">Recently opened</option>
              <option value="created">Date created</option>
              <option value="name">Name</option>
            </select>
          </label>
          <span className="text-xs text-zinc-600">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </span>
        </div>

        {isLoading ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Loading your projects…
          </div>
        ) : projects.length ? (
          <section aria-label="Projects" className="grid gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((entry, index) => (
              <article
                key={entry.id}
                className="group overflow-hidden rounded-xl border border-white/[0.08] bg-[#202023] transition hover:-translate-y-0.5 hover:border-[#ffb648]/30 hover:shadow-xl hover:shadow-black/20"
              >
                <div
                  role="img"
                  aria-label={`Arrangement preview for ${entry.name}`}
                  className="relative aspect-[16/7] border-b border-white/[0.06] bg-[#1e1e22] bg-cover bg-center"
                  style={{ backgroundImage: `url("${entry.preview}")` }}
                >
                  {index === 0 && entry.lastOpenedAt && sortOrder === "recent" && !search && (
                    <span className="absolute left-3 top-3 rounded bg-black/55 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[#ffcc7b] backdrop-blur">
                      Most recent
                    </span>
                  )}
                  <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded bg-black/55 px-2 py-1 text-[9px] text-zinc-300 backdrop-blur">
                    {entry.source === "cloud" ? <Cloud size={11} /> : <Music2 size={11} />}
                    {entry.source === "cloud" ? "Cloud" : "On this device"}
                  </span>
                </div>
                <div className="p-4">
                  <h2 className="truncate text-sm font-medium text-zinc-100">{entry.name}</h2>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
                    <div>
                      <p className="text-zinc-600">Created</p>
                      <p className="mt-0.5 text-zinc-400">{dateLabel(entry.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-600">Last opened</p>
                      <p className="mt-0.5 text-zinc-400">{dateLabel(entry.lastOpenedAt)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openProject(entry)}
                    disabled={openingId !== null}
                    className="mt-4 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-white/[0.08] bg-[#2b2b30] text-xs font-medium text-zinc-200 transition hover:border-[#ffb648]/35 hover:bg-[#34343a] disabled:cursor-wait disabled:opacity-60"
                  >
                    {openingId === entry.id ? (
                      <Loader2 size={13} className="animate-spin" aria-hidden />
                    ) : (
                      <FolderOpen size={13} aria-hidden />
                    )}
                    Open Project
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-[#202023] text-[#ffb648]">
              <Music2 size={20} aria-hidden />
            </span>
            <h2 className="mt-4 text-base font-medium text-zinc-200">
              {search ? "No matching projects" : "Your next track starts here"}
            </h2>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
              {search
                ? "Try another name or clear your search."
                : "Create a project to start recording, arranging, and making music."}
            </p>
            {!search && (
              <button
                type="button"
                onClick={onCreate}
                className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-[#ffb648] px-4 text-xs font-semibold text-[#1d1d20] hover:bg-[#ffc167]"
              >
                <Plus size={14} aria-hidden />
                Create a Project
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
