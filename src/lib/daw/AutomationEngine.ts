import { uid, type AutomationLane, type AutomationMode, type AutomationPoint } from "./types";

type ParameterKey = `${string}:${string}`;
type AudioValueTransform = (value: number) => number;

interface ParameterBinding {
  parameter: AudioParam;
  transform: AudioValueTransform;
}

export interface RecordedAutomationPoint {
  laneId: string;
  point: AutomationPoint;
  replacePoints?: AutomationPoint[];
}

interface TouchState {
  lane: AutomationLane;
  startTick: number;
  tickOffset: number;
  mode: "touch" | "latch";
  recordedIds: string[];
}

function key(ownerId: string, parameterId: string): ParameterKey {
  return `${ownerId}:${parameterId}`;
}

export function automationValueAt(
  points: AutomationPoint[],
  tick: number,
  scale: "linear" | "log" = "linear"
): number {
  const sorted = points;
  if (!sorted.length) return 0;
  if (tick <= sorted[0].tick) return sorted[0].value;
  let low = 0;
  let high = sorted.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid].tick <= tick) low = mid;
    else high = mid;
  }
  const a = sorted[low];
  const b = sorted[high];
  if (tick >= b.tick) return b.value;
  const t = (tick - a.tick) / Math.max(1, b.tick - a.tick);
  if ((a.curve === "exponential" || (!a.curve && scale === "log")) && a.value > 0 && b.value > 0) {
    return a.value * (b.value / a.value) ** t;
  }
  if (a.curve !== "bezier") return a.value + (b.value - a.value) * t;
  const control = (a.value + b.value) / 2 + (a.tension ?? 0) * (b.value - a.value) / 2;
  return (1 - t) ** 2 * a.value + 2 * (1 - t) * t * control + t ** 2 * b.value;
}

export class AutomationEngine {
  private parameters = new Map<ParameterKey, ParameterBinding[]>();
  private touches = new Map<string, TouchState>();
  private writePoints = new Map<string, AutomationPoint[]>();
  private tick = 0;
  private playing = false;

  bindParameter(
    ownerId: string,
    parameterId: string,
    parameter: AudioParam,
    transform: AudioValueTransform = (value) => value
  ): () => void {
    const parameterKey = key(ownerId, parameterId);
    const binding = { parameter, transform };
    const bindings = this.parameters.get(parameterKey) ?? [];
    const existingIndex = bindings.findIndex((item) => item.parameter === parameter);
    if (existingIndex >= 0) bindings[existingIndex] = binding;
    else bindings.push(binding);
    this.parameters.set(parameterKey, bindings);
    return () => {
      const current = this.parameters.get(parameterKey);
      if (!current) return;
      const remaining = current.filter((item) => item !== binding);
      if (remaining.length) this.parameters.set(parameterKey, remaining);
      else this.parameters.delete(parameterKey);
    };
  }

  unbindOwner(ownerId: string): void {
    const prefix = `${ownerId}:`;
    for (const parameterKey of this.parameters.keys()) {
      if (parameterKey.startsWith(prefix)) this.parameters.delete(parameterKey);
    }
  }

  setClock(tick: number, playing: boolean): void {
    this.tick = tick;
    this.playing = playing;
    if (!playing) this.writePoints.clear();
  }

  scheduleWindow(
    lanes: AutomationLane[],
    modes: Record<string, AutomationMode>,
    fromTick: number,
    toTick: number,
    timeAt: (tick: number) => number,
    regionBounds: (regionId: string) => { start: number; end: number } | undefined
  ): void {
    if (toTick <= fromTick) return;
    for (const lane of lanes) {
      if ((modes[lane.ownerId] ?? "off") === "off") continue;
      const bindings = this.parameters.get(key(lane.ownerId, lane.parameterId));
      if (!bindings?.length || lane.points.length === 0) continue;
      const bounds = lane.scope === "region" && lane.regionId
        ? regionBounds(lane.regionId)
        : undefined;
      const offset = lane.scope === "region" ? bounds?.start ?? Number.NaN : 0;
      if (!Number.isFinite(offset)) continue;
      const windowFrom = Math.max(fromTick, offset);
      const windowTo = bounds ? Math.min(toTick, bounds.end) : toTick;
      if (windowTo <= windowFrom) continue;
      const points = lane.points
        .map((point) => ({
          ...point,
          curve: point.curve ?? (lane.scale === "log" ? "exponential" : undefined),
          tick: point.tick + offset,
        }));
      const valueAtStart = Math.min(lane.max, Math.max(lane.min, automationValueAt(points, windowFrom, lane.scale)));
      for (const binding of bindings) {
        binding.parameter.setValueAtTime(binding.transform(valueAtStart), timeAt(windowFrom));
      }

      const boundaries = [windowFrom, ...points
        .map((point) => point.tick)
        .filter((tick) => tick > windowFrom && tick < windowTo), windowTo];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const source = points.find((point, index) =>
          point.tick <= start && (points[index + 1]?.tick ?? Infinity) >= end
        );
        const curve = source?.curve ?? "linear";
        const count = curve === "bezier" ? 8 : 1;
        const startValue = Math.min(lane.max, Math.max(lane.min, automationValueAt(points, start, lane.scale)));
        for (let step = 1; step <= count; step++) {
          const eventTick = start + (end - start) * step / count;
          const value = Math.min(lane.max, Math.max(lane.min, automationValueAt(points, eventTick, lane.scale)));
          const at = timeAt(eventTick);
          for (const binding of bindings) {
            const audioValue = binding.transform(value);
            const audioStartValue = binding.transform(startValue);
            if (lane.step) {
              binding.parameter.setValueAtTime(audioValue, at);
            } else if (curve === "exponential" && audioStartValue > 0 && audioValue > 0) {
              binding.parameter.exponentialRampToValueAtTime(audioValue, at);
            } else {
              binding.parameter.linearRampToValueAtTime(audioValue, at);
            }
          }
        }
      }
    }
  }

  recordControl(
    lane: AutomationLane | undefined,
    mode: AutomationMode,
    value: number,
    tickOffset = 0
  ): RecordedAutomationPoint | null {
    if (!lane || !this.playing || mode === "off" || mode === "read") return null;
    const tick = Math.max(0, this.tick - tickOffset);
    if ((mode === "touch" || mode === "latch") && !this.touches.has(lane.id)) {
      this.touches.set(lane.id, {
        lane: structuredClone(lane),
        startTick: tick,
        tickOffset,
        mode,
        recordedIds: [],
      });
    }
    const point: AutomationPoint = { id: uid(), tick, value };
    this.touches.get(lane.id)?.recordedIds.push(point.id);
    const threshold = 12;
    const points = mode === "write"
      ? (this.writePoints.get(lane.id) ?? lane.points)
          .filter((item) => Math.abs(item.tick - tick) > threshold)
      : lane.points;
    const replacement = mode === "write" ? [...points, point].sort((a, b) => a.tick - b.tick) : undefined;
    if (replacement) this.writePoints.set(lane.id, replacement);
    return {
      laneId: lane.id,
      point,
      ...(replacement ? { replacePoints: replacement } : {}),
    };
  }

  recordContinuous(
    lanes: AutomationLane[],
    modes: Record<string, AutomationMode>,
    readValue: (lane: AutomationLane) => number | undefined,
    tickOffset: (lane: AutomationLane) => number
  ): RecordedAutomationPoint[] {
    if (!this.playing) return [];
    const points: RecordedAutomationPoint[] = [];
    const activeWriteLanes = new Set(
      lanes.filter((lane) => modes[lane.ownerId] === "write").map((lane) => lane.id),
    );
    for (const laneId of this.writePoints.keys()) {
      if (!activeWriteLanes.has(laneId)) this.writePoints.delete(laneId);
    }
    for (const lane of lanes) {
      if ((modes[lane.ownerId] ?? "off") !== "write") continue;
      const value = readValue(lane);
      if (value === undefined || !Number.isFinite(value)) continue;
      const point = this.recordControl(lane, "write", value, tickOffset(lane));
      if (point) points.push(point);
    }
    return points;
  }

  finishTouches(lanes: AutomationLane[], modes: Record<string, AutomationMode>): RecordedAutomationPoint[] {
    const output: RecordedAutomationPoint[] = [];
    for (const [laneId, touch] of this.touches) {
      const lane = lanes.find((item) => item.id === laneId);
      if (!lane || modes[lane.ownerId] !== touch.mode) continue;
      const recorded = lane.points.filter((point) => touch.recordedIds.includes(point.id));
      const releaseTick = Math.max(
        this.tick - touch.tickOffset,
        recorded.reduce((latest, point) => Math.max(latest, point.tick), 0)
      );
      if (touch.mode === "latch") {
        const lastValue = recorded.at(-1)?.value;
        if (lastValue !== undefined) {
          const retained = touch.lane.points.filter((point) => point.tick < touch.startTick);
          output.push({
            laneId,
            point: { id: uid(), tick: releaseTick, value: lastValue },
            replacePoints: [...retained, ...recorded.filter((point) => point.tick < releaseTick), { id: uid(), tick: releaseTick, value: lastValue }]
              .sort((a, b) => a.tick - b.tick),
          });
        }
        continue;
      }
      const returnTick = releaseTick + 120;
      const returnValue = automationValueAt(touch.lane.points, returnTick, touch.lane.scale);
      output.push(
        { laneId, point: { id: uid(), tick: releaseTick, value: automationValueAt(lane.points, releaseTick, lane.scale) } },
        { laneId, point: { id: uid(), tick: returnTick, value: returnValue } }
      );
    }
    this.touches.clear();
    return output;
  }
}

export const automationEngine = new AutomationEngine();
