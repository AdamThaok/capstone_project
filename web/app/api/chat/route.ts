// app/api/chat/route.ts
// Next.js API route for the OPM chatbot — answers via Gemini, with a built-in FAQ fallback.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { askText } from "@/opm/pipeline/llm/gemini";

const SYSTEM_PROMPT = `You are an OPM (Object-Process Methodology) expert assistant for the OPM2Code system.
You specialize in ISO 19450:2015 — the international standard for OPM diagrams.
Answer questions about OPM concepts, diagram rules, ISO 19450 requirements, and how to fix diagram errors.
Be concise, practical, and give concrete examples. Respond in the same language the user writes in.
If the user writes in Hebrew, respond in Hebrew.`;

export async function POST(req: Request) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok") {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    // Answer with Gemini (then the built-in FAQ fallback further below).

    // ── Gemini fallback ───────────────────────────────────────────────────────
    const {
        message = "",
        diagram_errors = [],
        conversation_id = "default",
        coverage_report = null,
    } = (body as Record<string, unknown>);

    const msgStr = String(message).toLowerCase();
    const errors = Array.isArray(diagram_errors) ? (diagram_errors as string[]) : [];

    if (process.env.GOOGLE_API_KEY && String(message).trim()) {
        try {
            const prompt = errors.length > 0
                ? `${SYSTEM_PROMPT}\n\nThe user's OPM diagram has these validation errors:\n${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\nUser: ${message}`
                : `${SYSTEM_PROMPT}\n\nUser: ${message}`;

            const reply = await askText(prompt);
            return NextResponse.json({
                reply,
                mode: errors.length > 0 ? "error_guide" : "general",
                conversation_id,
                error_count: errors.length,
                pipeline_blocked: errors.length > 0,
            });
        } catch (e) {
            console.warn("[chat] Gemini failed:", (e as Error).message);
        }
    }

    // ── Built-in static FAQ (last resort) ─────────────────────────────────────

    if (errors.length > 0) {
        const errorList = errors
            .map((e: string, i: number) => `${i + 1}. ${e}`)
            .join("\n");
        return NextResponse.json({
            reply: [
                "⚠️ **הדיאגרמה שלך מכילה שגיאות — הצינור מושהה.**\n",
                "לא ניתן להמשיך לייצור הקוד עד שכל השגיאות יתוקנו על ידך.\n",
                "**השגיאות שנמצאו:**\n",
                errorList,
                "\n**מה לעשות:**",
                "תקן כל שגיאה בדיאגרמה שלך (ב-OPCloud או בכלי הציור שלך),",
                "ואז העלה מחדש את הדיאגרמה המתוקנת.",
                "\nהצינור יחדש את ריצתו אוטומטית לאחר שהדיאגרמה תעבור אימות מלא.",
            ].join("\n"),
            mode: "error_guide",
            conversation_id,
            error_count: errors.length,
            pipeline_blocked: true,
        });
    }

    // Coverage question shortcut (fallback mode).
    const cr = coverage_report as Record<string, unknown> | null;
    if (cr && (msgStr.includes("coverage") || msgStr.includes("כיסוי") || msgStr.includes("מכוסה") || msgStr.includes("כמה"))) {
        const pct  = cr["coverage_pct"] as number ?? 0;
        const cov  = cr["covered"] as number ?? 0;
        const tot  = cr["total_elements"] as number ?? 0;
        const miss = (cr["missing"] as string[]) ?? [];
        const obj  = cr["objects"]   as Record<string, number> ?? {};
        const proc = cr["processes"] as Record<string, number> ?? {};
        const lnk  = cr["links"]     as Record<string, number> ?? {};
        return NextResponse.json({
            reply: [
                `📊 **Coverage דיאגרמה: ${pct}%**`,
                ``,
                `✅ מכוסים: **${cov}** מתוך **${tot}** אלמנטים`,
                ``,
                `**פירוט לפי סוג:**`,
                `• Objects: ${obj["covered"] ?? 0}/${obj["total"] ?? 0}`,
                `• Processes: ${proc["covered"] ?? 0}/${proc["total"] ?? 0}`,
                `• Links: ${lnk["covered"] ?? 0}/${lnk["total"] ?? 0}`,
                miss.length > 0
                    ? `\n**אלמנטים חסרים (${miss.length}):** ${miss.slice(0, 8).join(", ")}${miss.length > 8 ? ` ועוד ${miss.length - 8}...` : ""}`
                    : `\n✅ כל האלמנטים מכוסים!`,
            ].join("\n"),
            mode: "general",
            conversation_id,
            error_count: 0,
            pipeline_blocked: false,
        });
    }

    // Simple FAQ fallback for general questions.
    let reply =
        "שאלה מצוינת! אני העוזר ה-OPM שלך. " +
        "אני יכול לענות על שאלות לגבי ISO 19450, כללי OPM, ודיאגרמות. " +
        "מה תרצה לדעת?";

    if (msgStr.includes("-ing") || msgStr.includes("gerund") || msgStr.includes("תהליך")) {
        reply =
            "**שמות תהליכים ב-OPM** חייבים:\n" +
            "• להסתיים ב-'-ing' (גרונד) — לדוגמה: *Order Processing*, *Data Validating*\n" +
            "• להיות ב-Title Case (כל מילה מתחילה באות גדולה)\n\n" +
            "❌ לא נכון: 'Approval', 'Submit'\n" +
            "✅ נכון: 'Approving', 'Submitting'\n\n" +
            "*(ISO 19450 §6.3)*";
    } else if (msgStr.includes("object") || msgStr.includes("אובייקט") || msgStr.includes("plural") || msgStr.includes("רבים")) {
        reply =
            "**שמות אובייקטים ב-OPM** חייבים:\n" +
            "• להיות ביחיד וב-Title Case\n" +
            "• עבור אוספים: הוסף 'Set' או 'Group'\n\n" +
            "❌ לא נכון: 'Customers', 'ingredients'\n" +
            "✅ נכון: 'Customer Group', 'Ingredient Set'\n\n" +
            "*(ISO 19450 §6.2)*";
    } else if (msgStr.includes("state") || msgStr.includes("מצב")) {
        reply =
            "**מצבים (States) ב-OPM:**\n" +
            "• חייבים להיות באותיות קטנות בלבד (lowercase)\n" +
            "• חייבים להופיע בתוך האובייקט שלהם\n" +
            "• מצב התחלתי: גבול עבה (initial state)\n" +
            "• מצב סופי: גבול כפול (final state)\n\n" +
            "❌ לא נכון: 'Locked', 'Submitted'\n" +
            "✅ נכון: 'locked', 'submitted'\n\n" +
            "*(ISO 19450 §7)*";
    } else if (msgStr.includes("link") || msgStr.includes("קישור") || msgStr.includes("arrow")) {
        reply =
            "**סוגי קישורים ב-OPM:**\n\n" +
            "**פרוצדורליים (תהליך ↔ אובייקט):**\n" +
            "• Consumption (צריכה): אובייקט נצרך על ידי תהליך\n" +
            "• Result (תוצאה): תהליך יוצר אובייקט\n" +
            "• Effect (השפעה): תהליך משנה אובייקט\n" +
            "• Agent (סוכן): גורם אנושי מפעיל תהליך\n" +
            "• Instrument (כלי): גורם לא-אנושי נדרש לתהליך\n\n" +
            "**מבניים (אובייקט ↔ אובייקט):**\n" +
            "• Aggregation, Exhibition, Generalization, Instantiation";
    }

    return NextResponse.json({
        reply,
        mode: "general",
        conversation_id,
        error_count: 0,
        pipeline_blocked: false,
    });
}
