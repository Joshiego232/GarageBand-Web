import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/songs - list all saved songs
export async function GET() {
  try {
    const songs = await db.song.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, updatedAt: true },
    });
    return NextResponse.json(songs);
  } catch (e) {
    console.error("list songs failed", e);
    return NextResponse.json({ error: "Failed to list songs" }, { status: 500 });
  }
}

// POST /api/songs - create or update a song (upsert by id)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, data } = body as { id?: string; name: string; data: string };
    if (!name || !data) {
      return NextResponse.json({ error: "name and data are required" }, { status: 400 });
    }
    if (id) {
      const existing = await db.song.findUnique({ where: { id } });
      if (existing) {
        const updated = await db.song.update({
          where: { id },
          data: { name, data },
        });
        return NextResponse.json({ id: updated.id, updatedAt: updated.updatedAt });
      }
    }
    const created = await db.song.create({
      data: { name, data },
    });
    return NextResponse.json({ id: created.id, updatedAt: created.updatedAt });
  } catch (e) {
    console.error("save song failed", e);
    return NextResponse.json({ error: "Failed to save song" }, { status: 500 });
  }
}
