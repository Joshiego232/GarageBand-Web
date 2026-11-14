"use client";

// ============================================================
// My Songs modal - list songs saved on this browser, open or
// delete them, and save the current project. Mounted when
// ui.modal === 'mySongs'.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Music2, Save, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDAW } from "@/lib/daw/store";
import type { Project } from "@/lib/daw/types";

interface SongMeta {
  id: string;
  name: string;
  updatedAt: string;
}

const SCROLLBAR =
  "[scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent";

export function MySongsModal() {
  const modal = useDAW((s) => s.ui.modal);
  const project = useDAW((s) => s.project);
  const loadProject = useDAW((s) => s.loadProject);
  const setModal = useDAW((s) => s.setModal);

  const open = modal === "mySongs";

  // null = loading, [] = loaded but empty
  const [songs, setSongs] = useState<SongMeta[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/songs");
      if (!res.ok) throw new Error("list failed");
      const json = (await res.json()) as SongMeta[];
      setSongs(Array.isArray(json) ? json : []);
    } catch {
      setSongs([]);
      toast.error("Could not load songs");
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const loadSongs = async () => {
      try {
        const res = await fetch("/api/songs");
        if (!res.ok) throw new Error("list failed");
        const json = (await res.json()) as SongMeta[];
        if (!cancelled) setSongs(Array.isArray(json) ? json : []);
      } catch {
        if (!cancelled) {
          setSongs([]);
          toast.error("Could not load songs");
        }
      }
    };

    void loadSongs();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const openSong = async (id: string) => {
    setOpeningId(id);
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as {
        id: string;
        name: string;
        data: string;
      };
      const parsed = JSON.parse(json.data) as Project;
      loadProject(parsed); // also closes the modal
      toast.success(`Opened "${json.name}"`);
    } catch {
      toast.error("Could not open that song");
    } finally {
      setOpeningId(null);
    }
  };

  const confirmDelete = async () => {
    const id = deleteId;
    setDeleteId(null);
    if (!id) return;
    try {
      const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setSongs((s) => (s ? s.filter((x) => x.id !== id) : s));
      toast.success("Song deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const saveCurrent = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          name: project.name,
          data: JSON.stringify(project),
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const json = (await res.json()) as { id: string };
      // remember the database id so the next save updates this song
      useDAW.setState((s) => ({ project: { ...s.project, id: json.id } }));
      toast.success("Saved");
      refresh();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteTarget = songs?.find((s) => s.id === deleteId) ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && setModal("none")}>
        <DialogContent className="sm:max-w-[480px] bg-[#1d1d20] border-black/60 text-zinc-200">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">My Songs</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Songs saved from this browser. Open one to continue working on it.
            </DialogDescription>
          </DialogHeader>

          {/* Song list */}
          {songs === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-zinc-500">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Loading songs...
            </div>
          ) : songs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[12px] text-zinc-600">
              <Music2 size={20} aria-hidden />
              No saved songs yet
            </div>
          ) : (
            <div
              className={`max-h-80 overflow-y-auto -mx-1 px-1 space-y-1 ${SCROLLBAR}`}
            >
              {songs.map((song) => (
                <div
                  key={song.id}
                  className="flex items-center gap-2.5 rounded-md border border-transparent hover:border-black/50 hover:bg-[#2a2a2f] px-2 py-2 transition-colors"
                >
                  <span
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-md bg-[#2a2a2f] border border-black/40 flex items-center justify-center"
                  >
                    <Music2 size={14} className="text-[#ffb648]" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-zinc-200 truncate">{song.name}</p>
                    <p className="text-[10px] text-zinc-500">
                      {formatDistanceToNow(new Date(song.updatedAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => openSong(song.id)}
                    disabled={openingId === song.id}
                    className="h-7 shrink-0 px-3 rounded-md bg-[#ffb648] text-[#1d1d20] text-[11px] font-semibold hover:bg-[#ffc167] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {openingId === song.id && (
                      <Loader2 size={11} className="animate-spin" aria-hidden />
                    )}
                    Open
                  </button>
                  <button
                    onClick={() => setDeleteId(song.id)}
                    aria-label={`Delete ${song.name}`}
                    className="h-7 w-7 shrink-0 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors flex items-center justify-center"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Save current */}
          <div className="border-t border-black/50 pt-3 flex flex-col gap-2">
            <button
              onClick={saveCurrent}
              disabled={saving}
              className="h-8 self-start px-3 rounded-md bg-[#ffb648] text-[#1d1d20] text-[12px] font-semibold hover:bg-[#ffc167] transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Save size={13} aria-hidden />
              )}
              Save Current Song
            </button>
            <p className="text-[10px] text-zinc-600 leading-snug">
              Audio recordings live in this browser (IndexedDB); songs with
              recordings reopen best on this device.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
      >
        <AlertDialogContent className="bg-[#1d1d20] border-black/60 text-zinc-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">
              Delete Song?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500">
              This will permanently remove &quot;{deleteTarget?.name}&quot; from this
              browser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-black/60 bg-[#2f2f34] text-zinc-300 hover:bg-[#3a3a41] hover:text-zinc-200">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-400/40"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
