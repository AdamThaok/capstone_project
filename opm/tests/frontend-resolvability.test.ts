import { describe, it, expect } from "vitest";
import {
    frontendResolvabilityFailures,
    composeClosureFailures,
    tsconfigClosureFailures,
} from "@/opm/pipeline/agents/testing-agent";
import type { FileSpec } from "@/opm/pipeline/agents/types";

// Regression for the exact boot defects that shipped in opm-project-4a298ca6 and
// forced hand-fixing: a missing react-router-dom dependency (white screen), main.tsx
// importing a never-emitted ./index.css (the file-lane enforcer dropped it), and a
// docker-compose naming a frontend/Dockerfile that was never generated. These must now
// be caught DETERMINISTICALLY — the real build tier is env-gated off by default, so
// before this tier existed all three sailed through the loop.

const pkg = (deps: Record<string, string>): FileSpec => ({
    path: "frontend/package.json",
    content: JSON.stringify({ dependencies: deps, devDependencies: {} }),
});

describe("frontendResolvabilityFailures", () => {
    it("flags a bare import not declared in package.json (react-router-dom)", () => {
        const files: FileSpec[] = [
            pkg({ react: "^18", "react-dom": "^18", axios: "^1" }),
            { path: "frontend/src/App.tsx", content: "import { BrowserRouter } from 'react-router-dom'\nexport default function App(){return null}" },
        ];
        const f = frontendResolvabilityFailures(files);
        expect(f.some((x) => x.id === "npm install: react-router-dom")).toBe(true);
    });

    it("flags a dangling relative import (missing ./index.css)", () => {
        const files: FileSpec[] = [
            pkg({ react: "^18", "react-dom": "^18" }),
            { path: "frontend/src/main.tsx", content: "import './index.css'\nimport App from './App'" },
            { path: "frontend/src/App.tsx", content: "export default function App(){return null}" },
        ];
        const f = frontendResolvabilityFailures(files);
        expect(f.some((x) => x.detail.includes("index.css"))).toBe(true);
    });

    it("passes when the dep is declared and the css is emitted", () => {
        const files: FileSpec[] = [
            pkg({ react: "^18", "react-dom": "^18", "react-router-dom": "^6" }),
            { path: "frontend/src/main.tsx", content: "import './index.css'\nimport { BrowserRouter } from 'react-router-dom'" },
            { path: "frontend/src/index.css", content: "body{margin:0}" },
        ];
        expect(frontendResolvabilityFailures(files)).toEqual([]);
    });

    it("never flags react / react-dom / node builtins", () => {
        const files: FileSpec[] = [
            pkg({}),
            { path: "frontend/src/main.tsx", content: "import React from 'react'\nimport { createRoot } from 'react-dom/client'" },
        ];
        expect(frontendResolvabilityFailures(files)).toEqual([]);
    });
});

describe("composeClosureFailures", () => {
    it("flags a docker-compose Dockerfile that isn't emitted", () => {
        const files: FileSpec[] = [
            { path: "docker-compose.yml", content: "services:\n  frontend:\n    build:\n      context: ./frontend\n      dockerfile: Dockerfile\n" },
            { path: "backend/Dockerfile", content: "FROM python:3.11-slim" },
        ];
        const f = composeClosureFailures(files);
        expect(f.some((x) => x.id.includes("frontend/Dockerfile"))).toBe(true);
    });

    it("passes when the referenced Dockerfile is emitted", () => {
        const files: FileSpec[] = [
            { path: "docker-compose.yml", content: "services:\n  frontend:\n    build:\n      context: ./frontend\n      dockerfile: Dockerfile\n" },
            { path: "frontend/Dockerfile", content: "FROM node:20-alpine" },
        ];
        expect(composeClosureFailures(files)).toEqual([]);
    });

    // Regression: context "." + a repo-root-relative dockerfile path must NOT false-positive
    // (this exact shape stalled the FTT2 run and gated off the real build/boot check).
    it("passes with context '.' and a root-relative dockerfile path", () => {
        const files: FileSpec[] = [
            { path: "docker-compose.yml", content: "services:\n  backend:\n    build:\n      context: .\n      dockerfile: backend/Dockerfile\n  frontend:\n    build:\n      context: .\n      dockerfile: frontend/Dockerfile\n" },
            { path: "backend/Dockerfile", content: "FROM python:3.11-slim" },
            { path: "frontend/Dockerfile", content: "FROM node:20-alpine" },
        ];
        expect(composeClosureFailures(files)).toEqual([]);
    });
});

describe("tsconfigClosureFailures", () => {
    // Regression: the exact frontend-build break from the FTT2 run — tsconfig.json
    // references ./tsconfig.node.json which was never emitted -> `vite build` fails.
    it("flags a tsconfig 'references' path that isn't emitted", () => {
        const files: FileSpec[] = [
            { path: "frontend/tsconfig.json", content: JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, include: ["src"], references: [{ path: "./tsconfig.node.json" }] }) },
        ];
        const f = tsconfigClosureFailures(files);
        expect(f.some((x) => x.id.includes("tsconfig.node.json"))).toBe(true);
    });

    it("passes for a self-contained tsconfig (no references)", () => {
        const files: FileSpec[] = [
            { path: "frontend/tsconfig.json", content: JSON.stringify({ compilerOptions: { jsx: "react-jsx", moduleResolution: "Bundler" }, include: ["src", "vite.config.ts"] }) },
        ];
        expect(tsconfigClosureFailures(files)).toEqual([]);
    });

    it("passes when the referenced tsconfig.node.json IS emitted", () => {
        const files: FileSpec[] = [
            { path: "frontend/tsconfig.json", content: JSON.stringify({ compilerOptions: {}, references: [{ path: "./tsconfig.node.json" }] }) },
            { path: "frontend/tsconfig.node.json", content: JSON.stringify({ compilerOptions: {} }) },
        ];
        expect(tsconfigClosureFailures(files)).toEqual([]);
    });
});
