import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearPrepCache } from "@/opm/pipeline/infra/cache";

export const runtime = "nodejs";

// POST /api/cache/clear — wipe the parse/spec/super-prompt cache so the next run
// re-runs stages 1-3 from scratch (use after changing a Stage 1-3 prompt).
export async function POST() {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok") {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const cleared = clearPrepCache();
    return NextResponse.json({ ok: true, cleared });
}
