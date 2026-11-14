import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/songs/[id] - load a song's full data
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const song = await db.song.findUnique({ where: { id } });
    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 });
    }
    return NextResponse.json(song);
  } catch (e) {
    console.error("load song failed", e);
    return NextResponse.json({ error: "Failed to load song" }, { status: 500 });
  }
}

// DELETE /api/songs/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.song.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("delete song failed", e);
    return NextResponse.json({ error: "Failed to delete song" }, { status: 500 });
  }
}
