"use client";

// ============================================================
// ShortcutsOverlay: full-screen keyboard-shortcuts help panel.
// Grouped by menu (from the COMMANDS registry) plus a Musical
// Typing section with a static key-mapping diagram.
// ============================================================

import { useEffect, useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { COMMANDS, MOD, type Command } from "@/lib/daw/commands";
import { useDAW } from "@/lib/daw/store";
import { cn } from "@/lib/utils";

const GROUP_ORDER = ["File", "Edit", "Track", "Region", "Mix", "View", "Transport"];

// Musical typing mapping: white keys A..' (C..F of the next octave)
// and the black keys W E T Y U O P between them.
const MT_WHITE = ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'"];
const MT_BLACK: Array<[number, string]> = [
  [0, "W"],
  [1, "E"],
  [3, "T"],
  [4, "Y"],
  [5, "U"],
  [7, "O"],
  [8, "P"],
];

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-black/50 bg-[#2f2f34] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 shadow-sm",
        className
      )}
    >
      {children}
    </kbd>
  );
}

function CommandRow({ command }: { command: Command }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/30 py-1">
      <span className="truncate text-[12px] text-zinc-300">{command.label}</span>
      {command.shortcut ? (
        <Kbd className="shrink-0 whitespace-nowrap">{command.shortcut}</Kbd>
      ) : null}
    </div>
  );
}

/** Static mini piano strip showing the computer-key layout */
function TypingStrip() {
  return (
    <div className="relative w-fit">
      <div className="flex">
        {MT_WHITE.map((letter) => (
          <div
            key={letter}
            className="flex h-14 w-8 items-end justify-center rounded-b border border-black/40 bg-gradient-to-b from-[#fafafa] to-[#d8d8dc] pb-1"
          >
            <span className="font-mono text-[10px] leading-none text-zinc-600">{letter}</span>
          </div>
        ))}
      </div>
      {MT_BLACK.map(([after, letter]) => (
        <div
          key={letter}
          className="absolute top-0 z-10 flex h-9 w-5 -translate-x-1/2 items-end justify-center rounded-b border border-black/60 bg-[#17171a] pb-0.5"
          style={{ left: `${((after + 1) / MT_WHITE.length) * 100}%` }}
        >
          <span className="font-mono text-[9px] leading-none text-zinc-400">{letter}</span>
        </div>
      ))}
    </div>
  );
}

export function ShortcutsOverlay() {
  const open = useDAW((s) => s.ui.panels.help);
  const togglePanel = useDAW((s) => s.togglePanel);

  const groups = useMemo(() => {
    const byMenu = new Map<string, Command[]>();
    for (const c of COMMANDS) {
      const arr = byMenu.get(c.menu) ?? [];
      arr.push(c);
      byMenu.set(c.menu, arr);
    }
    return GROUP_ORDER.filter((g) => byMenu.has(g)).map((g) => ({
      name: g,
      commands: byMenu.get(g) ?? [],
    }));
  }, []);

  // Escape closes the overlay
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        useDAW.getState().togglePanel("help");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={() => togglePanel("help")}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-black/60 bg-[#232327] shadow-2xl"
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-black/50 px-5 py-3.5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h2>
              <span className="text-[11px] text-zinc-500">
                {MOD === "Cmd" ? "shown for macOS" : "shown for Windows / Linux / Chromebook"}
              </span>
            </div>
            <button
              type="button"
              aria-label="Close keyboard shortcuts"
              onClick={() => togglePanel("help")}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="[scrollbar-color:#4a4a52_transparent] [scrollbar-width:thin] overflow-y-auto p-5">
            {/* Musical typing */}
            <section aria-label="Musical typing" className="mb-6">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#ffb648]">
                Musical Typing
              </h3>
              <div className="rounded-lg border border-black/50 bg-[#1d1d20] p-3.5">
                <div className="flex flex-wrap items-start gap-5">
                  <TypingStrip />
                  <div className="flex min-w-[220px] flex-1 flex-col justify-center">
                    <div className="flex items-center justify-between gap-3 border-b border-black/30 py-1 text-[12px] text-zinc-300">
                      <span>Octave down / up</span>
                      <span className="flex shrink-0 gap-1">
                        <Kbd>Z</Kbd>
                        <Kbd>X</Kbd>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b border-black/30 py-1 text-[12px] text-zinc-300">
                      <span>Velocity down / up</span>
                      <span className="flex shrink-0 gap-1">
                        <Kbd>C</Kbd>
                        <Kbd>V</Kbd>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-1 text-[12px] text-zinc-300">
                      <span>Toggle Musical Typing</span>
                      <Kbd className="shrink-0">{MOD}+K</Kbd>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                  With Musical Typing on and a software instrument track selected, the middle row of
                  your keyboard plays notes. A through &apos; spans one and a half octaves from the
                  current octave.
                </p>
              </div>
            </section>

            {/* Command sections in a 2-column grid */}
            <div className="grid items-start gap-x-8 gap-y-5 md:grid-cols-2">
              {groups.map((group) => (
                <section key={group.name} aria-label={`${group.name} shortcuts`}>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#ffb648]">
                    {group.name}
                  </h3>
                  <div>
                    {group.commands.map((command) => (
                      <CommandRow key={command.id} command={command} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-black/40 px-5 py-3 text-[11px] leading-relaxed text-zinc-500">
            On Mac, use <Kbd>Cmd</Kbd>. On Windows, Chromebook and Linux, use <Kbd>Ctrl</Kbd>.{" "}
            <Kbd>?</Kbd> shows/hides this panel.
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
