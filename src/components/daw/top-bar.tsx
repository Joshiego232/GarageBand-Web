"use client";

// ============================================================
// TopBar - the signature GarageBand control bar.
// [transport cluster] [amber LCD: position / tempo / signature /
// key] [panel toggles + project name + master volume & meter]
// The LCD position readout is updated by a requestAnimationFrame
// loop writing straight into span refs (no React state) so it
// stays smooth at 60fps.
// ============================================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  Cable,
  Circle,
  CircleHelp,
  Clock,
  Library,
  List,
  Music4,
  Piano,
  PanelBottom,
  Play,
  Repeat,
  Repeat2,
  Share2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  Volume2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Meter } from "@/components/daw/controls/meter";
import { runCommandById } from "@/lib/daw/commands";
import { engine } from "@/lib/daw/engine";
import { useDAW } from "@/lib/daw/store";
import {
  NOTE_NAMES,
  barTicks,
  formatBarsBeats,
  formatTime,
  keyLabel,
} from "@/lib/daw/utils";
import { cn } from "@/lib/utils";
import { MidiControlSurface } from "@/components/daw/panels/midi-control-surface";
import { LCDChordDisplay } from "@/components/daw/LCDChordDisplay";

const MONO: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};
const LCD_GLOW: CSSProperties = { textShadow: "0 0 6px rgba(255,182,72,0.45)" };

// ------------------------------------------------------------
// Shared quiet icon button (GarageBand control style)
// ------------------------------------------------------------

interface IconButtonProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

function IconButton({ label, active, onClick, className, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "h-8 w-8 shrink-0 rounded-md bg-gradient-to-b from-[#3a3a3a] to-[#292929] hover:from-[#454545] hover:to-[#303030] border border-black/70 shadow-[inset_0_1px_rgba(255,255,255,.08),0_1px_1px_rgba(0,0,0,.4)] flex items-center justify-center text-zinc-300 transition-colors",
        active && "text-[#ffb648] bg-[#ffb648]/15 border-[#ffb648]/40",
        className
      )}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------
// LCD
// ------------------------------------------------------------

function LCD() {
  const project = useDAW((s) => s.project);
  const setTempo = useDAW((s) => s.setTempo);
  const setTimeSig = useDAW((s) => s.setTimeSig);
  const setKey = useDAW((s) => s.setKey);

  const [posMode, setPosMode] = useState<"bars" | "time">("bars");
  const [editingTempo, setEditingTempo] = useState(false);

  // ---- live position readout (direct DOM writes, 60fps) ----
  const posMajorRef = useRef<HTMLSpanElement>(null);
  const posMinorRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef(posMode);
  const timeSigRef = useRef(project.timeSig);
  const tempoRef = useRef(project.tempo);

  // keep mirror refs current (after paint, never during render)
  useEffect(() => {
    modeRef.current = posMode;
    timeSigRef.current = project.timeSig;
    tempoRef.current = project.tempo;
  });

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const major = posMajorRef.current;
      const minor = posMinorRef.current;
      if (major && minor) {
        const countIn = engine.getCountInRemaining();
        if (countIn > 0) {
          // count-in countdown takes over the display, big
          major.textContent = String(countIn);
          minor.textContent = "";
          major.style.fontSize = "22px";
        } else {
          const tick = engine.currentTick();
          if (modeRef.current === "bars") {
            const s = formatBarsBeats(tick, timeSigRef.current);
            const dot = s.indexOf(".");
            major.textContent = s.slice(0, dot);
            minor.textContent = s.slice(dot);
            major.style.fontSize = "22px";
          } else {
            major.textContent = formatTime(tick, tempoRef.current);
            minor.textContent = "";
            major.style.fontSize = "17px";
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- tempo: drag to scrub / double-click to type / click to prompt ----
  const dragYRef = useRef(0);
  const dragTempoRef = useRef(120);
  const draggedRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);

  const commitTempo = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) setTempo(n);
    setEditingTempo(false);
  };

  const handleTempoPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editingTempo) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragYRef.current = e.clientY;
    dragTempoRef.current = useDAW.getState().project.tempo;
    draggedRef.current = false;
  };

  const handleTempoPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const dy = dragYRef.current - e.clientY; // up = faster
    if (Math.abs(dy) > 3) draggedRef.current = true;
    const delta = Math.round(dy / 6); // 1 BPM per 6px
    if (delta !== 0) setTempo(dragTempoRef.current + delta);
  };

  const handleTempoPointerUp = () => {
    if (draggedRef.current) return;
    // a lone click opens the prompt fallback; a second click within
    // the window is the first half of a double-click instead
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      const v = window.prompt(
        "Tempo (BPM, 30 - 260)",
        String(useDAW.getState().project.tempo)
      );
      if (v !== null) {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) setTempo(n);
      }
    }, 280);
  };

  const handleTempoDoubleClick = () => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setEditingTempo(true);
  };

  const handleTempoKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setTempo(useDAW.getState().project.tempo + 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setTempo(useDAW.getState().project.tempo - 1);
    }
  };

  return (
    <div
      className="w-full max-w-2xl h-11 rounded-md bg-[#101013] border border-black/70 shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)] px-3 py-1.5 flex items-center gap-3 min-w-0"
      style={{ ...MONO, color: "#ffb648" }}
    >
      {/* position display */}
      <div className="flex items-center gap-1.5 shrink-0 min-w-0">
        <div className="flex items-baseline" data-testid="lcd-position" style={LCD_GLOW}>
          <span
            ref={posMajorRef}
            className="text-[22px] font-bold leading-none tabular-nums tracking-tight"
          >
            1
          </span>
          <span
            ref={posMinorRef}
            className="text-[14px] leading-none tabular-nums opacity-90"
          >
            .1.1.01
          </span>
        </div>
        <div className="flex flex-col gap-[2px]">
          <button
            type="button"
            aria-label="Show position as bars and beats"
            aria-pressed={posMode === "bars"}
            onClick={() => setPosMode("bars")}
            className={cn(
              "h-[13px] w-[13px] rounded-[3px] flex items-center justify-center transition-colors",
              posMode === "bars"
                ? "bg-[#ffb648]/20 text-[#ffb648]"
                : "text-[#ffb648]/50 hover:text-[#ffb648]"
            )}
          >
            <List className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            aria-label="Show position as time"
            aria-pressed={posMode === "time"}
            onClick={() => setPosMode("time")}
            className={cn(
              "h-[13px] w-[13px] rounded-[3px] flex items-center justify-center transition-colors",
              posMode === "time"
                ? "bg-[#ffb648]/20 text-[#ffb648]"
                : "text-[#ffb648]/50 hover:text-[#ffb648]"
            )}
          >
            <Clock className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      <div className="w-px self-stretch bg-[#ffb648]/15" />

      {/* tempo */}
      <div className="min-w-0 shrink-0">
        {editingTempo ? (
          <input
            autoFocus
            type="number"
            min={30}
            max={260}
            defaultValue={project.tempo}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commitTempo(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitTempo(e.currentTarget.value);
              else if (e.key === "Escape") setEditingTempo(false);
            }}
            aria-label="Tempo in BPM"
            className="w-16 bg-transparent border border-[#ffb648]/40 rounded px-1 text-[15px] font-bold outline-none select-text tabular-nums"
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            title="Tempo - drag up or down, double-click to type"
            onPointerDown={handleTempoPointerDown}
            onPointerMove={handleTempoPointerMove}
            onPointerUp={handleTempoPointerUp}
            onDoubleClick={handleTempoDoubleClick}
            onKeyDown={handleTempoKeyDown}
            className="flex items-baseline gap-1 cursor-ns-resize touch-none select-text rounded px-0.5"
            style={LCD_GLOW}
          >
            <span className="text-[15px] leading-none" aria-hidden>
              ♩
            </span>
            <span className="text-[12px] leading-none opacity-80" aria-hidden>
              =
            </span>
            <span className="text-[19px] font-bold leading-none tabular-nums">
              {project.tempo}
            </span>
            <span className="text-[8px] uppercase tracking-wider opacity-60 leading-none">
              bpm
            </span>
          </div>
        )}
      </div>

      <div className="w-px self-stretch bg-[#ffb648]/15 hidden sm:block" />

      {/* time signature + key (stacked, each row clickable) */}
      <div className="flex flex-col justify-center gap-[2px] shrink-0 ml-auto">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Time signature"
              className="text-[13px] leading-none px-1.5 py-1 rounded tabular-nums text-left min-w-[42px] hover:bg-[#ffb648]/10 transition-colors"
            >
              {project.timeSig[0]}/{project.timeSig[1]}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-52 bg-[#26262b] border-black/60 text-zinc-200 p-3 shadow-xl"
          >
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
              Time Signature
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="block text-[9px] uppercase text-zinc-500 mb-1">Beats</span>
                <Select
                  value={String(project.timeSig[0])}
                  onValueChange={(v) => setTimeSig(parseInt(v, 10), project.timeSig[1])}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full h-7 bg-[#2f2f34] border-black/50 text-zinc-200 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#26262b] border-black/60 text-zinc-200 max-h-56">
                    {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                      <SelectItem
                        key={n}
                        value={String(n)}
                        className="text-xs focus:bg-[#3a3a41] focus:text-zinc-100"
                      >
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex-1">
                <span className="block text-[9px] uppercase text-zinc-500 mb-1">
                  Note Value
                </span>
                <Select
                  value={String(project.timeSig[1])}
                  onValueChange={(v) => setTimeSig(project.timeSig[0], parseInt(v, 10))}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full h-7 bg-[#2f2f34] border-black/50 text-zinc-200 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#26262b] border-black/60 text-zinc-200">
                    {[4, 8].map((d) => (
                      <SelectItem
                        key={d}
                        value={String(d)}
                        className="text-xs focus:bg-[#3a3a41] focus:text-zinc-100"
                      >
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Project key"
              className="text-[11px] leading-none px-1.5 py-1 rounded text-left min-w-[42px] whitespace-nowrap hover:bg-[#ffb648]/10 transition-colors"
            >
              {keyLabel(project.keyTonic, project.keyMode)}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-60 bg-[#26262b] border-black/60 text-zinc-200 p-3 shadow-xl"
          >
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Key</p>
            <div className="grid grid-cols-6 gap-1">
              {NOTE_NAMES.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setKey(i, project.keyMode)}
                  aria-pressed={i === project.keyTonic}
                  className={cn(
                    "h-7 rounded text-[11px] border transition-colors",
                    i === project.keyTonic
                      ? "bg-[#ffb648]/20 border-[#ffb648]/50 text-[#ffb648]"
                      : name.includes("#")
                        ? "bg-[#232327] border-black/50 text-zinc-400 hover:bg-[#3a3a41]"
                        : "bg-[#2f2f34] border-black/40 text-zinc-300 hover:bg-[#3a3a41]"
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="flex gap-1 mt-2">
              {(["major", "minor"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setKey(project.keyTonic, mode)}
                  aria-pressed={project.keyMode === mode}
                  className={cn(
                    "flex-1 h-7 rounded text-[11px] border capitalize transition-colors",
                    project.keyMode === mode
                      ? "bg-[#ffb648]/20 border-[#ffb648]/50 text-[#ffb648]"
                      : "bg-[#2f2f34] border-black/40 text-zinc-300 hover:bg-[#3a3a41]"
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="w-px self-stretch bg-cyan-300/10" />
      <LCDChordDisplay keySignature={{ tonic: project.keyTonic, mode: project.keyMode }} />
    </div>
  );
}

// ------------------------------------------------------------
// TopBar
// ------------------------------------------------------------

export function TopBar() {
  const [midiSurfaceOpen, setMidiSurfaceOpen] = useState(false);
  const project = useDAW((s) => s.project);
  const transport = useDAW((s) => s.transport);
  const panels = useDAW((s) => s.ui.panels);
  const editorMode = useDAW((s) => s.ui.editorMode);
  const automationView = useDAW((s) => s.ui.automationView);
  const setMetronome = useDAW((s) => s.setMetronome);
  const setCountIn = useDAW((s) => s.setCountIn);
  const setMasterVolume = useDAW((s) => s.setMasterVolume);
  const setProjectName = useDAW((s) => s.setProjectName);
  const togglePanel = useDAW((s) => s.togglePanel);
  const setUI = useDAW((s) => s.setUI);

  const getMasterLevel = useCallback(() => engine.getMasterLevel()[0], []);

  const openSmartControls = () => {
    setUI({ panels: { ...panels, editor: true }, editorMode: "smart" });
  };

  return (
    <div className="studio-metal h-14 shrink-0 flex items-center gap-2 px-2 sm:px-3 border-b border-black/80 shadow-[inset_0_-1px_rgba(255,255,255,.04)]">
      {/* transport cluster */}
      <div className="flex items-center gap-1 rounded-md bg-[#1a1a1d] border border-black/50 p-1 shrink-0">
        <IconButton
          label="Rewind one bar"
          onClick={() =>
            engine.setPlayhead(
              Math.max(0, engine.currentTick() - barTicks(project.timeSig))
            )
          }
        >
          <SkipBack className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Fast-forward one bar"
          onClick={() =>
            engine.setPlayhead(
              engine.currentTick() + barTicks(project.timeSig)
            )
          }
        >
          <SkipForward className="h-4 w-4" />
        </IconButton>
        <IconButton label="Stop" onClick={() => engine.stop()}>
          <Square className="h-3.5 w-3.5 fill-current" />
        </IconButton>
        <IconButton
          label={transport.playing ? "Pause" : "Play"}
          onClick={() => engine.togglePlay()}
          className={cn(
            transport.playing &&
              "text-[#4ec24a] bg-[#4ec24a]/10 border-[#4ec24a]/30 hover:bg-[#4ec24a]/15"
          )}
        >
          <Play className="h-4 w-4 fill-current" />
        </IconButton>
        <IconButton
          label={transport.recording ? "Stop recording" : "Record"}
          onClick={() => runCommandById("transport.record")}
          className={cn(
            "hover:text-[#e5484d]",
            transport.recording &&
              "text-[#e5484d] bg-[#e5484d]/10 border-[#e5484d]/40 animate-pulse ring-2 ring-[#e5484d]/30"
          )}
        >
          <Circle className={cn("h-3.5 w-3.5", transport.recording && "fill-current")} />
        </IconButton>

        <div className="w-px self-stretch bg-black/50 mx-0.5 hidden sm:block" />

        <IconButton
          label="Cycle"
          active={project.cycleOn}
          onClick={() => runCommandById("transport.cycle")}
          className="hidden sm:flex"
        >
          <Repeat className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Metronome"
          active={project.metronome}
          onClick={() => setMetronome(!project.metronome)}
          className="hidden sm:flex"
        >
          <Music4 className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Count-in"
          active={project.countIn}
          onClick={() => setCountIn(!project.countIn)}
          className="hidden sm:flex"
        >
          <Timer className="h-4 w-4" />
        </IconButton>
      </div>

      {/* LCD */}
      <div className="flex-1 min-w-0 flex justify-center">
        <LCD />
      </div>

      {/* right cluster: panel toggles, project name, master */}
      <div className="flex items-center gap-1 shrink-0">
        <IconButton
          label="Automation View (A)"
          active={automationView}
          onClick={() => setUI({ automationView: !automationView })}
        >
          <svg aria-hidden="true" viewBox="0 0 18 18" className="h-4 w-4" fill="none">
            <path d="M2 13.5 6.5 9l4 2.5L16 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="2" cy="13.5" r="1.5" fill="currentColor" />
            <circle cx="6.5" cy="9" r="1.5" fill="currentColor" />
            <circle cx="10.5" cy="11.5" r="1.5" fill="currentColor" />
            <circle cx="16" cy="4.5" r="1.5" fill="currentColor" />
          </svg>
        </IconButton>
        <IconButton
          label="Bounce Project or Section (⌘/Ctrl+B)"
          onClick={() => runCommandById("file.bounce")}
        >
          <Share2 className="h-4 w-4" />
        </IconButton>
        <button
          title="Smart Composer - describe a song, AI arranges it"
          onClick={() => useDAW.getState().setModal("composer")}
          className="h-8 px-2.5 rounded-md bg-gradient-to-b from-[#ffc466] to-[#eda23c] text-[#19191b] text-[11px] font-semibold flex items-center gap-1.5 hover:brightness-105 transition shadow-sm"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Compose</span>
        </button>
        <IconButton
          label="Library"
          active={panels.library}
          onClick={() => togglePanel("library")}
        >
          <Library className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Quick Help"
          active={panels.help}
          onClick={() => togglePanel("help")}
          className="hidden lg:flex"
        >
          <CircleHelp className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="On-Screen Keyboard"
          active={panels.keyboard}
          onClick={() => togglePanel("keyboard")}
          className="hidden sm:flex"
        >
          <Piano className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Loop Browser"
          active={panels.loops}
          onClick={() => togglePanel("loops")}
          className="hidden sm:flex"
        >
          <Repeat2 className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Editor"
          active={panels.editor}
          onClick={() => togglePanel("editor")}
          className="hidden sm:flex"
        >
          <PanelBottom className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Smart Controls"
          active={panels.editor && editorMode === "smart"}
          onClick={openSmartControls}
          className="hidden sm:flex"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="MIDI Control Surface"
          active={midiSurfaceOpen}
          onClick={() => setMidiSurfaceOpen(true)}
          className="hidden sm:flex"
        >
          <Cable className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Mixer"
          active={panels.mixer}
          onClick={() => togglePanel("mixer")}
          className="hidden sm:flex"
        >
          <AudioLines className="h-4 w-4" />
        </IconButton>

        <input
          value={project.name}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Untitled"
          aria-label="Project name"
          spellCheck={false}
          maxLength={48}
          className="hidden md:block w-28 bg-transparent text-[12px] rounded px-1.5 py-1 text-zinc-300 border border-transparent hover:border-black/40 hover:bg-black/30 focus:border-[#ffb648]/40 focus:bg-black/40 outline-none select-text"
        />

        <div className="hidden lg:flex items-center gap-2 pl-1">
          <Volume2 className="h-4 w-4 text-zinc-400 shrink-0" />
          <Slider
            value={[Math.round(project.masterVolume * 100)]}
            min={0}
            max={125}
            step={1}
            onValueChange={(v) => setMasterVolume(v[0] / 100)}
            aria-label="Master volume"
            className="w-24 shrink-0 cursor-pointer
              [&_[data-slot=slider-track]]:bg-[#101013]
              [&_[data-slot=slider-track]]:border
              [&_[data-slot=slider-track]]:border-black/60
              [&_[data-slot=slider-range]]:bg-[#ffb648]/80
              [&_[data-slot=slider-thumb]]:size-3
              [&_[data-slot=slider-thumb]]:bg-[#2f2f34]
              [&_[data-slot=slider-thumb]]:border-[#ffb648]/60"
          />
        </div>
        <Meter
          getLevel={getMasterLevel}
          width={46}
          height={8}
          className="hidden sm:block shrink-0"
        />
      </div>
      {midiSurfaceOpen && (
        <MidiControlSurface onClose={() => setMidiSurfaceOpen(false)} />
      )}
    </div>
  );
}
