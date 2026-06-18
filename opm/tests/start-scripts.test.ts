import { describe, it, expect } from "vitest";
import { ensureLauncherFiles, START_BAT, START_SH } from "@/opm/pipeline/stages/stage4-codegen";

// Every generated project (and its downloaded zip) must ship a one-click local
// launcher, and the launcher commands must match the app's real run contract:
// backend from repo root as `uvicorn backend.main:app` on :8000, frontend Vite dev.

describe("ensureLauncherFiles", () => {
    it("injects start.bat and start.sh at the project root", () => {
        const out = ensureLauncherFiles([{ path: "README.md", content: "# x" }]);
        const paths = out.map((f) => f.path);
        expect(paths).toContain("start.bat");
        expect(paths).toContain("start.sh");
    });

    it("launchers use the real run contract (uvicorn backend.main:app + vite dev)", () => {
        for (const s of [START_BAT, START_SH]) {
            expect(s).toContain("uvicorn backend.main:app");
            expect(s).toContain("npm run dev");
            expect(s).toContain("requirements.txt");
        }
    });

    it("overwrites a model-emitted start.bat so there is one canonical copy", () => {
        const out = ensureLauncherFiles([{ path: "start.bat", content: "echo bogus" }]);
        const bats = out.filter((f) => f.path === "start.bat");
        expect(bats).toHaveLength(1);
        expect(bats[0].content).toBe(START_BAT);
    });
});
