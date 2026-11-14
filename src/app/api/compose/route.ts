import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

// POST /api/compose - AI Smart Composer
// The LLM acts as an arranger: it picks loops, instruments, tempo and key
// from the WebBand catalog; the client renders it with the loop engine.
export async function POST(req: NextRequest) {
  try {
    const { prompt } = (await req.json()) as { prompt?: string };
    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Describe the song you want" }, { status: 400 });
    }

    const catalog = `
DRUM LOOPS (id - name - genre):
dr-rock-basic "Rock Beat" 110bpm | dr-rock-drive "Driving Rock" 130bpm | dr-pop "Pop Groove" 100bpm | dr-pop-busy "Pop Busy" 105bpm | dr-boom "Boom Bap" hiphop 90bpm | dr-trap "Trap Roll" 140bpm | dr-house "Four on Floor" 124bpm | dr-house2 "House Groove" 122bpm | dr-funk "Funk Pocket" 98bpm | dr-disco "Disco Beat" 118bpm | dr-shuffle "Shuffle" 84bpm | dr-punk "Punk Fast" 160bpm | dr-latin "Latin Clave" 104bpm | dr-ballad "Ballad Brush" 72bpm
BASS LOOPS: bs-sub "Sub Drone" | bs-808 "808 Flow" | bs-walk "Walking Bass" | bs-pop "Pop Eighths" | bs-funk "Funk Bass"
CHORD/PAD LOOPS: ch-pad "Warm Pad Chords" | ch-swell "String Swell" | ch-block "Piano Chords" | ch-broken "Broken Piano" | ch-epiano "E.Piano Chords" | ch-arp "Arp Pattern" | ch-guitar "Strummed Guitar" | ch-stab "Synth Stabs" | ch-organ "Organ Chords"
MELODY LOOPS: me-hook "Pop Hook" | me-hook-min "Minor Hook" | me-flow "Melodic Flow" | me-sparse "Sparse Bells" | me-flute "Flute Line"
INSTRUMENTS: grand-piano bright-piano stage-epiano saw-lead warm-pad retro-chip sub-bass pluck-bass 808-bass string-ensemble tonewheel-organ nylon-guitar steel-guitar marimba celesta wood-flute drum-kit 808-kit`;

    const system = `You are an expert music arranger inside a web DAW. The user describes a song idea; you produce a JSON arrangement using ONLY loops and instruments from the catalog. Respond with STRICT JSON only, no markdown, no extra text.

JSON schema:
{
  "name": string (catchy song title, max 24 chars),
  "tempo": integer 60-170,
  "keyTonic": integer 0-11 (0=C,1=C#,2=D,...,9=A,11=B),
  "keyMode": "major"|"minor",
  "arrangement": [
    { "loopId": string (from catalog), "trackName": string (max 18 chars), "startBar": integer >= 0, "lengthBars": integer 4-64 }
  ]
}

Arranging rules:
- 4-6 tracks. Always include drums (except for ambient/podcast ideas), usually bass, chords/pad, and optionally a melody.
- Build a real arrangement: intro (fewer tracks, startBar>0 for some), then fuller sections. Total song 16-32 bars.
- Match genre to loops (hip-hop -> dr-boom/dr-trap + bs-808 + 808-bass; EDM -> dr-house + ch-stab + me-hook-min; rock -> dr-rock-drive + bs-pop + ch-guitar; jazz -> dr-shuffle + bs-walk + ch-epiano; latin -> dr-latin + nylon-guitar...).
- keyMode minor for dark/moody/sad/trap ideas, major for happy/upbeat/pop.
- lengthBars should align the song (multiple of 4).`;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        { role: "user", content: `Song idea: ${prompt}\n\nCatalog:\n${catalog}` },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    // extract JSON (model may wrap in fences despite instructions)
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: "Could not compose an arrangement" }, { status: 502 });
    }
    let arrangement: unknown;
    try {
      arrangement = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ error: "Could not parse the arrangement" }, { status: 502 });
    }
    return NextResponse.json({ arrangement });
  } catch (e) {
    console.error("compose failed", e);
    return NextResponse.json({ error: "The composer is unavailable right now" }, { status: 500 });
  }
}
