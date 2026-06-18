import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { computeCacheKeyFromBytes, hasPrepCache } from "@/opm/pipeline/infra/cache";

export const runtime = "nodejs";

// Must match FIXED_FORMAT in app/api/generate/route.ts — the cache key is hashed
// over (version + format + bytes), so a mismatch here would always report "miss".
const FIXED_FORMAT = "auto";

// POST /api/cache/check — given the SAME files the user is about to generate from,
// report whether stages 1-3 are already cached (so the upload card can say so
// before they click Generate). Hashes the bytes in memory; writes nothing, starts
// no job.
export async function POST(req: Request) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok") {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const filesRaw: File[] = (form.getAll("files") as File[])
        .filter((f): f is File => !!f && typeof f.size === "number");

    if (filesRaw.length === 0) {
        return NextResponse.json({ cached: false });
    }

    const buffers: Buffer[] = [];
    for (const f of filesRaw) {
        buffers.push(Buffer.from(await f.arrayBuffer()));
    }

    const key = computeCacheKeyFromBytes(buffers, FIXED_FORMAT);
    return NextResponse.json({ cached: hasPrepCache(key), key });
}
