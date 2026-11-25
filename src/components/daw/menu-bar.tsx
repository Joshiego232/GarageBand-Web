"use client";

// ============================================================
// MenuBar - top strip of the app: GarageBand Web identity, the menu
// bar (File / Edit / Track / Region / Mix / View) generated from
// the command registry, project name and the help toggle.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Apple, FolderOpen, UserRound } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COMMANDS, MENU_ORDER, type Command } from "@/lib/daw/commands";
import { useDAW } from "@/lib/daw/store";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { saveSong } from "@/lib/daw/saved-songs";
import { saveCloudProjectIfSignedIn } from "@/lib/daw/cloud-projects";
import { cn } from "@/lib/utils";

export function MenuBar() {
  const projectName = useDAW((s) => s.project.name);
  const project = useDAW((s) => s.project);
  const projectsScreen = useDAW((s) => s.ui.projectsScreen);
  const helpOpen = useDAW((s) => s.ui.panels.help);
  const togglePanel = useDAW((s) => s.togglePanel);
  const setModal = useDAW((s) => s.setModal);
  const { user, passwordRecovery } = useCloudAuth();
  const [closing, setClosing] = useState(false);

  const closeProject = async () => {
    if (closing) return;
    setClosing(true);
    try {
      const saved = await saveSong(project);
      useDAW.setState((state) => ({ project: { ...state.project, id: saved.id } }));
    } catch (error) {
      toast.error(
        `Could not close the project because saving failed: ${
          error instanceof Error ? error.message : "Browser storage unavailable"
        }`,
      );
      setClosing(false);
      return;
    }

    try {
      await saveCloudProjectIfSignedIn(useDAW.getState().project);
    } catch (error) {
      toast.error(
        `Saved on this device, but cloud sync failed: ${
          error instanceof Error ? error.message : "Cloud storage unavailable"
        }`,
      );
    }
    useDAW.getState().setUI({ projectsScreen: true, modal: "none" });
    setClosing(false);
  };

  useEffect(() => {
    if (passwordRecovery) setModal("mySongs");
  }, [passwordRecovery, setModal]);

  // Group the command registry by menu, keeping MENU_ORDER order.
  // Commands whose menu is not listed (e.g. "Transport") stay out of
  // the menu bar - they surface in the shortcuts overlay instead.
  const menus = useMemo(() => {
    const byMenu = new Map<string, Command[]>();
    for (const name of MENU_ORDER) byMenu.set(name, []);
    for (const c of COMMANDS) {
      const bucket = byMenu.get(c.menu);
      if (bucket) bucket.push(c);
    }
    return MENU_ORDER.map((name) => ({ name, items: byMenu.get(name) ?? [] }));
  }, []);

  return (
    <header className="studio-metal h-9 shrink-0 flex items-center gap-2 px-2 sm:px-3 border-b border-black/80 select-none shadow-[inset_0_-1px_rgba(255,255,255,.035)]">
      {/* app identity */}
      <div className="flex items-center gap-2 pr-1 shrink-0">
        <div
          className="h-5 w-5 rounded-[5px] bg-gradient-to-br from-[#ffb648] to-[#d98b1f] flex items-center justify-center shadow-sm"
          aria-hidden
        >
          <Apple className="h-3 w-3 text-white fill-white" strokeWidth={2} />
        </div>
        <span className="text-[12px] font-semibold text-zinc-200">GarageBand Web</span>
        <span className="hidden sm:inline text-[9px] leading-none px-1.5 py-[3px] rounded bg-[#ffb648]/15 text-[#ffb648] border border-[#ffb648]/30 tracking-wide uppercase">
          Studio
        </span>
      </div>

      {/* menus */}
      <nav className="flex items-center gap-0.5 min-w-0" aria-label="Application menus">
        {menus.map(({ name, items }) => (
          <DropdownMenu key={name}>
            <DropdownMenuTrigger
              // keep keys pressed while a menu is open away from the
              // global window-level shortcut dispatcher
              onKeyDown={(e) => e.stopPropagation()}
              className="px-2.5 py-1 rounded text-[12px] text-zinc-300 hover:bg-[#3a3a41] hover:text-zinc-100 data-[state=open]:bg-[#3a3a41] data-[state=open]:text-zinc-100 transition-colors outline-none cursor-default"
            >
              {name}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-[240px] bg-[#26262b] border-black/60 text-zinc-200 p-1 shadow-xl"
            >
              {items.map((c) => (
                <div key={c.id}>
                  {c.separatorBefore && <DropdownMenuSeparator className="bg-black/50 my-1" />}
                  <DropdownMenuItem
                    onClick={() => c.run()}
                    className="text-[12px] px-2 py-1.5 rounded-[4px] gap-4 cursor-default focus:bg-[#3a3a41] focus:text-zinc-100"
                  >
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.shortcut ? (
                      <span className="text-[10px] leading-none font-mono text-zinc-500 tabular-nums">
                        {c.shortcut}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </nav>

      {/* right side: account, project name + help */}
      <div className="ml-auto flex items-center gap-2 min-w-0 shrink-0">
        {!projectsScreen && (
          <button
            type="button"
            onClick={() => void closeProject()}
            disabled={closing}
            aria-label="Close project and return to all projects"
            title="Save and close this project"
            className="flex h-6 items-center gap-1.5 rounded border border-black/40 bg-[#2f2f34] px-2 text-[10px] text-zinc-300 transition-colors hover:bg-[#3a3a41] hover:text-zinc-100"
          >
            {closing ? "Saving…" : <><FolderOpen size={12} aria-hidden /><span className="hidden sm:inline">All Projects</span></>}
          </button>
        )}
        <button
          type="button"
          onClick={() => setModal("mySongs")}
          aria-label={user ? `Account: ${user.email}` : "Sign in or create an account"}
          title={user?.email ?? "Sign in or create an account"}
          className="flex h-6 max-w-[150px] items-center gap-1.5 rounded border border-black/40 bg-[#2f2f34] px-2 text-[10px] text-zinc-300 transition-colors hover:bg-[#3a3a41] hover:text-zinc-100"
        >
          <UserRound size={12} aria-hidden />
          <span className="truncate">{user?.email ?? "Sign in"}</span>
        </button>
        <span
          className="hidden md:block text-[11px] text-zinc-500 truncate max-w-[220px]"
          title={projectName}
        >
          {projectName}
        </span>
        <button
          type="button"
          onClick={() => togglePanel("help")}
          aria-label="Keyboard shortcuts"
          aria-pressed={helpOpen}
          title="Keyboard shortcuts (?)"
          className={cn(
            "h-6 w-6 rounded text-[11px] font-semibold flex items-center justify-center border transition-colors",
            helpOpen
              ? "text-[#ffb648] bg-[#ffb648]/15 border-[#ffb648]/40"
              : "text-zinc-400 bg-[#2f2f34] hover:bg-[#3a3a41] border-black/40"
          )}
        >
          ?
        </button>
      </div>
    </header>
  );
}
