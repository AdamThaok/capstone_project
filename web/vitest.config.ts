import { defineConfig } from "vitest/config";
import path from "node:path";

// This config lives in web/ (the project root). The OPM tests it runs live in
// ../opm/tests and import OPM code via the @/opm, @/web and @/app aliases, so
// mirror the tsconfig path map here.
export default defineConfig({
    test: {
        environment: "node",
        include: ["../opm/tests/**/*.test.ts"],
        globals: false,
    },
    resolve: {
        alias: {
            "@/opm": path.resolve(__dirname, "../opm"),
            "@/web": path.resolve(__dirname, "."),
            "@/app": path.resolve(__dirname, "app"),
        },
    },
});
