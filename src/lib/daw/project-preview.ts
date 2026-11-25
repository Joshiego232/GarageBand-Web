import type { Project } from "./types";

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    switch (character) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      default: return "&apos;";
    }
  });
}

function validColor(value: string | undefined, fallback: string): string {
  return value && /^#[\da-f]{3,8}$/i.test(value) ? value : fallback;
}

export function createProjectPreview(project: Project): string {
  const width = 640;
  const height = 280;
  const tracks = project.tracks.slice(0, 5);
  const longestTick = Math.max(
    1,
    ...tracks.flatMap((track) =>
      track.regions.map((region) => region.start + region.length),
    ),
  );
  const timelineWidth = width - 104;
  const rowHeight = 36;
  const rows = tracks.map((track, index) => {
    const y = 50 + index * rowHeight;
    const regions = track.regions.map((region) => {
      const x = 96 + (region.start / longestTick) * timelineWidth;
      const regionWidth = Math.max(3, (region.length / longestTick) * timelineWidth);
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${regionWidth.toFixed(1)}" height="13" rx="3" fill="${validColor(region.color, validColor(track.color, "#ffb648"))}" opacity="0.88"/>`;
    }).join("");
    return `<text x="14" y="${y + 10}" fill="#a1a1aa" font-size="9">${escapeXml(track.name.slice(0, 14))}</text><line x1="96" y1="${y + 24}" x2="626" y2="${y + 24}" stroke="#3f3f46" stroke-width="1"/>${regions}`;
  }).join("");

  const emptyLabel = tracks.length ? "" : '<text x="320" y="155" fill="#71717a" text-anchor="middle" font-size="12">No tracks yet</text>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#1e1e22"/><text x="14" y="22" fill="#f4f4f5" font-size="12" font-weight="600">${escapeXml(project.name)}</text><text x="626" y="22" fill="#a1a1aa" text-anchor="end" font-size="10">${project.tempo} BPM · ${tracks.length} tracks</text>${Array.from({ length: 9 }, (_, i) => `<line x1="${96 + i * (timelineWidth / 8)}" y1="34" x2="${96 + i * (timelineWidth / 8)}" y2="264" stroke="#303036" stroke-width="1"/>`).join("")}${rows}${emptyLabel}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
