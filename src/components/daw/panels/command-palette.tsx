"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Command, Play, Search, X } from "lucide-react";
import { COMMANDS, runCommandById } from "@/lib/daw/commands";

const CATEGORIES = ["All", "File", "Edit", "Track", "Region", "Mix", "View", "Transport"] as const;
type Category = (typeof CATEGORIES)[number];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => { setQuery(""); setCategory("All"); setOpen(true); };
    window.addEventListener("daw:command-palette", show);
    return () => window.removeEventListener("daw:command-palette", show);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const filtered = useMemo(() => COMMANDS.filter((item) => {
    if (category !== "All" && item.menu !== category) return false;
    const q = query.trim().toLowerCase();
    return !q || [item.label, item.menu, item.shortcut ?? ""].some((value) => value.toLowerCase().includes(q));
  }), [query, category]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette" className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-start justify-center p-4 pt-[10vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-2xl max-h-[78vh] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#202025] shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-black/50 bg-[#28282e]">
          <Command className="size-4 text-[#ffb648]" />
          <span className="text-xs font-semibold text-zinc-100">Command Palette</span>
          <span className="text-[10px] text-zinc-500">Search the studio</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto p-1 text-zinc-500 hover:text-white" aria-label="Close command palette"><X className="size-4" /></button>
        </div>
        <div className="p-3 border-b border-black/40 space-y-2">
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands: split, quantize, import, export…" className="w-full rounded-md border border-white/10 bg-[#151518] py-2 pl-9 pr-3 text-xs text-zinc-100 outline-none focus:border-[#ffb648]/50" />
          </div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`rounded px-2.5 py-1 text-[10px] border transition-colors ${category === item ? "bg-[#ffb648]/15 text-[#ffcb78] border-[#ffb648]/30" : "text-zinc-500 border-transparent hover:bg-white/5 hover:text-zinc-200"}`}>{item}</button>)}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {filtered.map((item) => <button key={item.id} type="button" onClick={() => { setOpen(false); runCommandById(item.id); }} className="w-full flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left hover:bg-[#34343b] hover:border-white/5 group">
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-zinc-100">{item.label}</span><span className="block text-[10px] text-zinc-600">{item.menu}</span></span>
            {item.shortcut && <kbd className="rounded border border-white/10 bg-[#17171b] px-2 py-1 text-[10px] font-mono text-zinc-500">{item.shortcut}</kbd>}
            <Play className="size-3 text-zinc-600 group-hover:text-[#ffb648]" />
          </button>)}
          {!filtered.length && <p className="p-8 text-center text-xs text-zinc-600">No commands match your search.</p>}
        </div>
        <div className="px-4 py-2 border-t border-black/50 bg-[#19191d] flex items-center justify-between text-[10px] text-zinc-600"><span>Press Esc to close · Ctrl/⌘ + K to open</span><span>{filtered.length} commands</span></div>
      </div>
    </div>
  );
}
