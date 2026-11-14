"use client";

// ============================================================
// New Project modal (welcome screen). Shown on first visit (page
// checks localStorage 'webband-seen-welcome'). Pick the demo song,
// a template, or reopen a recent song. Only its own buttons dismiss
// it - clicking outside / Esc is ignored.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Disc3,
  FilePlus2,
  Guitar,
  Mic,
  Music,
  Music2,
  Piano,
  Play,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDAW } from "@/lib/daw/store";
import { TEMPLATES, demoProject, type TemplateDef } from "@/lib/daw/loops";
import type { Project } from "@/lib/daw/types";

interface SongMeta {
  id: string;
  name: string;
  updatedAt: string;
}

const TEMPLATE_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  empty: { icon: FilePlus2, color: "#8fb44a" },
  hiphop: { icon: Disc3, color: "#e08e3c" },
  edm: { icon: Zap, color: "#d9b13b" },
  rock: { icon: Guitar, color: "#e0533d" },
  songwriter: { icon: Piano, color: "#3f9d8b" },
  podcast: { icon: Mic, color: "#c65cb8" },
};

const SCROLLBAR =
  "[scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent";

export function NewProjectModal() {
  const modal = useDAW((s) => s.ui.modal);
  const loadProject = useDAW((s) => s.loadProject);
  const setModal = useDAW((s) => s.setModal);

  const [recent, setRecent] = useState<SongMeta[] | null>(null);

  const open = modal === "newProject";

  // fetch recent songs (section only shows when the request succeeds)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/songs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("list failed"))))
      .then((json: SongMeta[]) => {
        if (alive) setRecent(Array.isArray(json) ? json : []);
      })
      .catch(() => {
        if (alive) setRecent(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const markSeen = () => {
    try {
      localStorage.setItem("webband-seen-welcome", "1");
    } catch {
      // storage unavailable - not fatal
    }
  };

  const loadDemo = () => {
    markSeen();
    loadProject(demoProject());
    toast.success("Neon Horizon loaded - press Space to play");
  };

  const loadTemplate = (t: TemplateDef) => {
    markSeen();
    loadProject(t.build());
    toast.success(`${t.name} started`);
  };

  const openRecent = async (id: string) => {
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as { id: string; name: string; data: string };
      const project = JSON.parse(json.data) as Project;
      markSeen();
      loadProject(project);
      toast.success(`Opened "${json.name}"`);
    } catch {
      toast.error("Could not open that song");
    }
  };

  const deleteRecent = async (id: string) => {
    try {
      const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setRecent((r) => (r ? r.filter((s) => s.id !== id) : r));
    } catch {
      toast.error("Could not delete that song");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          markSeen();
          setModal("none");
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className={`sm:max-w-[600px] max-h-[88vh] overflow-y-auto bg-[#1d1d20] border-black/60 text-zinc-200 ${SCROLLBAR}`}
      >
        <DialogHeader className="items-center text-center sm:text-center">
          <span
            aria-hidden
            className="h-12 w-12 rounded-xl flex items-center justify-center border border-black/40 shadow-lg shadow-black/40"
            style={{
              background: "linear-gradient(135deg, #ffb648, #e08e3c)",
              color: "#1d1d20",
            }}
          >
            <Music size={22} />
          </span>
          <DialogTitle className="text-xl text-zinc-100">
            WebBand Studio
          </DialogTitle>
          <DialogDescription className="text-[12px] text-zinc-500">
            A GarageBand-style studio for Windows, Chromebook &amp; Mac
          </DialogDescription>
        </DialogHeader>

        {/* Demo song */}
        <button
          onClick={loadDemo}
          className="w-full rounded-lg border border-[#ffb648]/30 bg-gradient-to-r from-[#ffb648]/10 to-transparent p-4 flex items-center gap-4 text-left transition hover:border-[#ffb648]/60 hover:from-[#ffb648]/15 cursor-pointer"
        >
          <span
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-full bg-[#ffb648] text-[#1d1d20] flex items-center justify-center"
          >
            <Play size={18} fill="currentColor" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-zinc-100">
              Demo Song
            </span>
            <span className="block text-[11px] text-zinc-400">
              Neon Horizon &mdash; hear a full arrangement right away
            </span>
          </span>
        </button>

        {/* Templates */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            Start a New Project
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TEMPLATES.map((t) => {
              const meta = TEMPLATE_ICONS[t.id] ?? {
                icon: FilePlus2,
                color: "#8fb44a",
              };
              const Icon = meta.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => loadTemplate(t)}
                  className="rounded-lg border border-black/60 bg-[#232327] p-3 text-left transition hover:bg-[#2c2c33] hover:ring-1 hover:ring-[#ffb648]/40 cursor-pointer"
                >
                  <span
                    aria-hidden
                    className="h-7 w-7 rounded-[8px] flex items-center justify-center border border-black/40 mb-2"
                    style={{
                      background: `linear-gradient(135deg, ${meta.color}38, ${meta.color}12)`,
                      color: meta.color,
                    }}
                  >
                    <Icon size={14} />
                  </span>
                  <span className="block text-[12px] font-medium text-zinc-200 truncate">
                    {t.name}
                  </span>
                  <span className="block text-[10px] text-zinc-500 leading-snug">
                    {t.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent songs (only when the fetch succeeded and has items) */}
        {recent !== null && recent.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Recent Songs
            </h3>
            <div
              className={`rounded-lg border border-black/60 bg-[#19191b] p-1.5 space-y-0.5 max-h-40 overflow-y-auto ${SCROLLBAR}`}
            >
              {recent.map((song) => (
                <div
                  key={song.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#2c2c33] transition-colors"
                >
                  <Music2 size={14} className="shrink-0 text-zinc-600" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-zinc-300 truncate">{song.name}</p>
                    <p className="text-[10px] text-zinc-600">
                      {formatDistanceToNow(new Date(song.updatedAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => openRecent(song.id)}
                    className="h-6 shrink-0 px-2 rounded-md bg-[#2f2f34] border border-black/40 text-[10px] text-zinc-200 hover:bg-[#3a3a41] transition-colors"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => deleteRecent(song.id)}
                    aria-label={`Delete ${song.name}`}
                    className="h-6 w-6 shrink-0 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors flex items-center justify-center"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <DialogFooter className="sm:justify-center border-t border-black/50 pt-3">
          <p className="text-[10px] text-zinc-600">
            v1.0 &mdash; all audio is synthesized in your browser
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
