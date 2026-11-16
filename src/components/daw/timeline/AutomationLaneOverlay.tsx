"use client";

import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { automationValueAt } from "@/lib/daw/AutomationEngine";
import { displayAutomationValue } from "@/lib/daw/automation-parameters";
import { useDAW } from "@/lib/daw/store";
import { uid, type AutomationLane, type AutomationPoint, type Track } from "@/lib/daw/types";
import { formatBarsBeats, snapTick } from "@/lib/daw/utils";

interface AutomationLaneOverlayProps {
  tracks: Track[];
  rows: { trackId: string; ownerId: string; y: number; height: number }[];
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  pxPerTick: number;
  snapGrid: number;
  timeSig: [number, number];
  masterTop?: number;
  masterHeight?: number;
}

type Gesture =
  | { kind: "insert"; lane: AutomationLane; pointId: string; startX: number; startY: number; anchorTick: number; anchorValue: number }
  | { kind: "points"; lane: AutomationLane; points: AutomationPoint[]; startX: number; startY: number; selectedIds: string[]; anchorTick: number; anchorValue: number }
  | { kind: "tension"; lane: AutomationLane; pointId: string; startY: number; laneHeight: number; anchorTension: number }
  | { kind: "marquee"; lane: AutomationLane; x0: number; y0: number; x1: number; y1: number };

function laneY(lane: AutomationLane, value: number, top: number, height: number): number {
  const ratio = lane.scale === "log" && lane.min > 0 && lane.max > lane.min
    ? (Math.log(Math.max(value, lane.min)) - Math.log(lane.min)) / (Math.log(lane.max) - Math.log(lane.min))
    : (value - lane.min) / Math.max(1e-9, lane.max - lane.min);
  return top + height - Math.min(1, Math.max(0, ratio)) * height;
}

function valueAtY(lane: AutomationLane, y: number, top: number, height: number): number {
  const ratio = 1 - Math.min(1, Math.max(0, (y - top) / height));
  if (lane.scale === "log" && lane.min > 0 && lane.max > lane.min) {
    return Math.exp(Math.log(lane.min) + ratio * (Math.log(lane.max) - Math.log(lane.min)));
  }
  return lane.min + ratio * (lane.max - lane.min);
}

export function AutomationLaneOverlay({
  tracks,
  rows,
  width,
  height,
  scrollX,
  scrollY,
  pxPerTick,
  snapGrid,
  timeSig,
  masterTop,
  masterHeight = 0,
}: AutomationLaneOverlayProps) {
  const project = useDAW((state) => state.project);
  const ui = useDAW((state) => state.ui);
  const gestureRef = useRef<Gesture | null>(null);
  const [selectedPointIds, setSelectedPointIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [hud, setHud] = useState<{ x: number; y: number; text: string } | null>(null);
  const lanes = project.automationLanes ?? [];
  const regionStarts = useMemo(
    () => new Map(tracks.flatMap((track) => track.regions.map((region) => [region.id, region.start] as const))),
    [tracks]
  );
  const regionLengths = useMemo(
    () => new Map(tracks.flatMap((track) => track.regions.map((region) => [region.id, region.length] as const))),
    [tracks]
  );
  const rowByTrack = new Map(rows.map((row) => [row.trackId, row]));

  const visibleLanes = (ownerId: string) => {
    const ownerLanes = lanes.filter((lane) => lane.ownerId === ownerId);
    if (ui.automationExpandedTracks.includes(ownerId)) return ownerLanes.slice(0, 3);
    const selected = ui.automationSelections[ownerId];
    const regionLane = ownerLanes.find(
      (lane) => lane.parameterId === selected && lane.regionId && ui.selectedRegionIds.includes(lane.regionId)
    );
    if (regionLane) return [regionLane];
    return ownerLanes.filter((lane) => lane.parameterId === selected).slice(0, 1);
  };

  const editLane = (lane: AutomationLane, points: AutomationPoint[]) => {
    useDAW.getState().saveAutomationLane({
      ...lane,
      points: points.map((point) => ({ ...point })).sort((a, b) => a.tick - b.tick),
    });
  };

  const laneAt = (x: number, y: number) => {
    for (const track of tracks) {
      const row = rowByTrack.get(track.id);
      if (!row) continue;
      const laneList = visibleLanes(row.ownerId);
      if (!laneList.length) continue;
      const bandHeight = Math.min(28, (row.height - 30) / laneList.length);
      const top = row.y - scrollY + row.height - bandHeight * laneList.length - 4;
      const index = Math.floor((y - top) / bandHeight);
      if (index >= 0 && index < laneList.length && y < top + bandHeight * laneList.length) {
        return { lane: laneList[index], top: top + index * bandHeight, height: bandHeight, offset: 0 };
      }
    }
    if (masterTop !== undefined && y >= masterTop - scrollY && y < masterTop - scrollY + masterHeight) {
      const laneList = visibleLanes("master");
      if (!laneList.length) return null;
      const bandHeight = (masterHeight - 22) / laneList.length;
      const top = masterTop - scrollY + 22;
      const index = Math.floor((y - top) / bandHeight);
      if (index >= 0 && index < laneList.length) {
        return { lane: laneList[index], top: top + index * bandHeight, height: bandHeight, offset: 0 };
      }
    }
    return null;
  };

  const coordinateFor = (lane: AutomationLane, point: AutomationPoint, top: number, bandHeight: number) => {
    const offset = lane.scope === "region" && lane.regionId ? regionStarts.get(lane.regionId) ?? 0 : 0;
    return {
      x: (point.tick + offset) * pxPerTick - scrollX,
      y: laneY(lane, point.value, top, bandHeight),
    };
  };

  const pointFromPointer = (
    lane: AutomationLane,
    clientX: number,
    clientY: number,
    top: number,
    bandHeight: number,
    altKey: boolean
  ): AutomationPoint => {
    const svg = svgRef.current;
    const bounds = svg?.getBoundingClientRect();
    const localX = bounds ? clientX - bounds.left : clientX;
    const localY = bounds ? clientY - bounds.top : clientY;
    const regionOffset = lane.scope === "region" && lane.regionId ? regionStarts.get(lane.regionId) ?? 0 : 0;
    let tick = (localX + scrollX) / pxPerTick - regionOffset;
    if (!altKey) tick = snapTick(tick, snapGrid);
    if (lane.scope === "region" && lane.regionId) {
      tick = Math.min(regionLengths.get(lane.regionId) ?? tick, tick);
    }
    return {
      id: "",
      tick: Math.max(0, tick),
      value: Math.min(lane.max, Math.max(lane.min, valueAtY(lane, localY, top, bandHeight))),
    };
  };

  const svgRef = useRef<SVGSVGElement>(null);
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (!gesture) {
      const hit = laneAt(x, y);
      if (hit) {
        const absoluteTick = Math.max(0, (x + scrollX) / pxPerTick);
        const value = valueAtY(hit.lane, y, hit.top, hit.height);
        setHud({ x: Math.min(width - 150, x + 12), y: Math.max(0, y - 28), text: `${displayAutomationValue(value, hit.lane.unit)} • Bar ${formatBarsBeats(absoluteTick, timeSig)}` });
      } else setHud(null);
      return;
    }
    if (gesture.kind === "tension") {
      const point = gesture.lane.points.find((item) => item.id === gesture.pointId);
      if (!point) return;
      const delta = (gesture.startY - event.clientY) / gesture.laneHeight * 2;
      editLane(gesture.lane, gesture.lane.points.map((item) =>
        item.id === gesture.pointId
          ? { ...item, curve: "bezier", tension: Math.min(1, Math.max(-1, gesture.anchorTension + delta)) }
          : item
      ));
      return;
    }
    if (gesture.kind === "marquee") {
      const box = {
        x: Math.min(gesture.x0, x),
        y: Math.min(gesture.y0, y),
        width: Math.abs(x - gesture.x0),
        height: Math.abs(y - gesture.y0),
      };
      setMarquee(box);
      gesture.x1 = x;
      gesture.y1 = y;
      return;
    }
    const boundsForLane = laneAt(gesture.startX, gesture.startY);
    if (!boundsForLane || boundsForLane.lane.id !== gesture.lane.id) return;
    const current = pointFromPointer(
      gesture.lane,
      event.clientX,
      event.clientY,
      boundsForLane.top,
      boundsForLane.height,
      event.altKey
    );
    const basePoints = gesture.kind === "insert" ? gesture.lane.points : gesture.points;
    const selection = gesture.kind === "insert" ? [gesture.pointId] : gesture.selectedIds;
    const deltaTick = current.tick - gesture.anchorTick;
    const deltaValue = current.value - gesture.anchorValue;
    const points = basePoints.map((point) =>
      selection.includes(point.id)
        ? { ...point, tick: Math.max(0, point.tick + deltaTick), value: Math.min(gesture.lane.max, Math.max(gesture.lane.min, point.value + deltaValue)) }
        : point
    );
    editLane(gesture.lane, points);
    setHud({ x: Math.min(width - 150, x + 12), y: Math.max(0, y - 28), text: `${displayAutomationValue(current.value, gesture.lane.unit)} • Bar ${formatBarsBeats(current.tick, timeSig)}` });
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const bounds = svg?.getBoundingClientRect();
    if (!svg || !bounds) return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const target = event.target as SVGElement;
    const laneInfo = laneAt(x, y);
    if (!laneInfo) return;
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    const pointId = target.dataset.pointId;
    const tensionId = target.dataset.tensionId;
    if (tensionId) {
      const point = laneInfo.lane.points.find((item) => item.id === tensionId);
      if (!point) return;
      gestureRef.current = { kind: "tension", lane: laneInfo.lane, pointId: tensionId, startY: event.clientY, laneHeight: laneInfo.height, anchorTension: point.tension ?? 0 };
      useDAW.getState().commit();
      return;
    }
    if (event.altKey && laneInfo.lane.points.length > 1) {
      const sorted = [...laneInfo.lane.points].sort((a, b) => a.tick - b.tick);
      const nearest = sorted.slice(0, -1).reduce<{ point: AutomationPoint; distance: number } | null>(
        (best, point, index) => {
          const a = coordinateFor(laneInfo.lane, point, laneInfo.top, laneInfo.height);
          const b = coordinateFor(laneInfo.lane, sorted[index + 1], laneInfo.top, laneInfo.height);
          const distance = Math.hypot(x - (a.x + b.x) / 2, y - (a.y + b.y) / 2);
          return !best || distance < best.distance ? { point, distance } : best;
        },
        null
      );
      if (nearest) {
        gestureRef.current = {
          kind: "tension",
          lane: laneInfo.lane,
          pointId: nearest.point.id,
          startY: event.clientY,
          laneHeight: laneInfo.height,
          anchorTension: nearest.point.tension ?? 0,
        };
        useDAW.getState().commit();
        return;
      }
    }
    if (pointId) {
      const point = laneInfo.lane.points.find((item) => item.id === pointId);
      if (!point) return;
      const selected = event.shiftKey
        ? selectedPointIds.includes(pointId)
          ? selectedPointIds.filter((id) => id !== pointId)
          : [...selectedPointIds, pointId]
        : selectedPointIds.includes(pointId) ? selectedPointIds : [pointId];
      setSelectedPointIds(selected);
      useDAW.getState().commit();
      gestureRef.current = {
        kind: "points",
        lane: laneInfo.lane,
        points: laneInfo.lane.points,
        selectedIds: selected,
        startX: x,
        startY: y,
        anchorTick: point.tick,
        anchorValue: point.value,
      };
      return;
    }
    if (event.shiftKey) {
      gestureRef.current = { kind: "marquee", lane: laneInfo.lane, x0: x, y0: y, x1: x, y1: y };
      return;
    }
    const regionOffset = laneInfo.lane.scope === "region" && laneInfo.lane.regionId
      ? regionStarts.get(laneInfo.lane.regionId) ?? 0
      : 0;
    const absoluteTick = (x + scrollX) / pxPerTick;
    let relativeTick = Math.max(0, snapTick(absoluteTick - regionOffset, event.altKey ? 1 : snapGrid));
    if (laneInfo.lane.scope === "region" && laneInfo.lane.regionId) {
      relativeTick = Math.min(regionLengths.get(laneInfo.lane.regionId) ?? relativeTick, relativeTick);
    }
    const point: AutomationPoint = {
      id: uid(),
      tick: relativeTick,
      value: valueAtY(laneInfo.lane, y, laneInfo.top, laneInfo.height),
    };
    useDAW.getState().commit();
    const insertedLane = { ...laneInfo.lane, points: [...laneInfo.lane.points, point] };
    editLane(laneInfo.lane, insertedLane.points);
    setSelectedPointIds([point.id]);
    gestureRef.current = { kind: "insert", lane: insertedLane, pointId: point.id, startX: x, startY: y, anchorTick: point.tick, anchorValue: point.value };
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.kind === "marquee") {
      const laneInfo = laneAt(gesture.x0, gesture.y0);
      if (laneInfo) {
        const x0 = Math.min(gesture.x0, gesture.x1);
        const x1 = Math.max(gesture.x0, gesture.x1);
        const y0 = Math.min(gesture.y0, gesture.y1);
        const y1 = Math.max(gesture.y0, gesture.y1);
        const selected = gesture.lane.points.filter((point) => {
          const pointPos = coordinateFor(gesture.lane, point, laneInfo.top, laneInfo.height);
          return pointPos.x >= x0 && pointPos.x <= x1 && pointPos.y >= y0 && pointPos.y <= y1;
        }).map((point) => point.id);
        setSelectedPointIds(selected);
      }
    }
    gestureRef.current = null;
    setMarquee(null);
    setHud(null);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  };

  const onDoubleClick = (event: MouseEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement;
    const pointId = target.dataset.pointId;
    if (!pointId) return;
    const laneId = target.dataset.laneId;
    const lane = lanes.find((item) => item.id === laneId);
    if (!lane) return;
    useDAW.getState().commit();
    editLane(lane, lane.points.filter((point) => point.id !== pointId));
    setSelectedPointIds((selected) => selected.filter((id) => id !== pointId));
  };

  const renderLane = (lane: AutomationLane, top: number, bandHeight: number, ownerId: string) => {
    const points = [...lane.points].sort((a, b) => a.tick - b.tick);
    if (!points.length) return null;
    const regionOffset = lane.scope === "region" && lane.regionId ? regionStarts.get(lane.regionId) ?? 0 : 0;
    const viewStart = scrollX / pxPerTick - regionOffset;
    const viewEnd = (scrollX + width) / pxPerTick - regionOffset;
    const preceding = points.filter((point) => point.tick <= viewStart).at(-1);
    const following = points.find((point) => point.tick >= viewEnd);
    const pathPoints: AutomationPoint[] = [
      {
        id: "viewport-start",
        tick: viewStart,
        value: automationValueAt(points, viewStart, lane.scale),
        curve: preceding?.curve,
        tension: preceding?.tension,
      },
      ...points.filter((point) => point.tick > viewStart && point.tick < viewEnd),
      {
        id: "viewport-end",
        tick: viewEnd,
        value: automationValueAt(points, viewEnd, lane.scale),
        curve: following?.curve,
        tension: following?.tension,
      },
    ];
    const path = pathPoints.map((point, index) => {
      const p = coordinateFor(lane, point, top, bandHeight);
      if (index === 0) return `M ${p.x} ${p.y}`;
      const previous = pathPoints[index - 1];
      const prev = coordinateFor(lane, previous, top, bandHeight);
      if (previous.curve === "bezier") {
        const controlY = (prev.y + p.y) / 2 - (previous.tension ?? 0) * bandHeight / 2;
        return `Q ${(prev.x + p.x) / 2} ${controlY} ${p.x} ${p.y}`;
      }
      return `L ${p.x} ${p.y}`;
    }).join(" ");
    const ownerLanes = visibleLanes(ownerId);
    return (
      <g key={lane.id}>
        <rect x={0} y={top} width={width} height={bandHeight} fill="rgba(8,10,14,.60)" stroke="rgba(255,255,255,.07)" />
        <rect x={0} y={top} width={width} height={bandHeight} fill="transparent" />
        <text x={8} y={top + 10} fill={lane.color} fontSize={8} fontFamily="ui-monospace, monospace">{lane.name}</text>
        <path d={path} fill="none" stroke={lane.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity=".92" style={{ filter: `drop-shadow(0 0 4px ${lane.color}99)` }} />
        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const a = coordinateFor(lane, point, top, bandHeight);
          const b = coordinateFor(lane, next, top, bandHeight);
          return (
            <g key={`handle-${point.id}`}>
              <circle
                cx={(a.x + b.x) / 2}
                cy={(a.y + b.y) / 2 - (point.tension ?? 0) * bandHeight / 2}
                r={4}
                fill="#17171b"
                stroke={lane.color}
                strokeWidth={1}
                data-tension-id={point.id}
                className="cursor-ns-resize"
              />
            </g>
          );
        })}
        {points.map((point) => {
          const position = coordinateFor(lane, point, top, bandHeight);
          const selected = selectedPointIds.includes(point.id);
          return (
            <g key={point.id}>
              {selected && <circle cx={position.x} cy={position.y} r={8} fill={lane.color} opacity=".22" />}
              <circle
                cx={position.x}
                cy={position.y}
                r={selected ? 4.5 : 3.5}
                fill="#17171b"
                stroke={lane.color}
                strokeWidth={1.7}
                data-point-id={point.id}
                data-lane-id={lane.id}
                className="cursor-move"
                style={{ filter: `drop-shadow(0 0 4px ${lane.color})` }}
              />
            </g>
          );
        })}
        <title>{lane.name}</title>
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      aria-label="Automation curve editor"
      className="absolute inset-0 z-[15] touch-none"
      style={{ width, height, pointerEvents: ui.automationView ? "auto" : "none" }}
      viewBox={`0 0 ${width} ${height}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {ui.automationView && rows.map((row) => {
        const ownerLanes = visibleLanes(row.ownerId);
        if (!ownerLanes.length) return null;
        const bandHeight = Math.min(28, (row.height - 30) / ownerLanes.length);
        const top = row.y - scrollY + row.height - bandHeight * ownerLanes.length - 4;
        return ownerLanes.map((lane, index) => renderLane(lane, top + bandHeight * index, bandHeight, row.ownerId));
      })}
      {ui.automationView && masterTop !== undefined && visibleLanes("master").map((lane, index, list) => {
        const bandHeight = (masterHeight - 22) / list.length;
        return renderLane(lane, masterTop - scrollY + 22 + index * bandHeight, bandHeight, "master");
      })}
      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.width}
          height={marquee.height}
          fill="rgba(110,170,255,.12)"
          stroke="rgba(130,190,255,.8)"
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {hud && (
        <foreignObject x={hud.x} y={hud.y} width={145} height={24} pointerEvents="none">
          <div className="rounded-full border border-white/10 bg-[#151519]/95 px-2.5 py-1 text-[9px] font-medium text-zinc-100 shadow-xl">
            {hud.text}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}
