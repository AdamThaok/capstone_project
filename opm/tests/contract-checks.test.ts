import { describe, it, expect } from "vitest";
import {
    schemaCasingIntegrityFailures,
    inlineBaseModelFailures,
    apiRouteCoverageFailures,
    apiCallValidityFailures,
    modelColumnFailures,
} from "@/opm/pipeline/agents/testing-agent";
import type { FileSpec } from "@/opm/pipeline/agents/types";

// Regression for the front<->back contract drift the audit found in the FTT2 app:
// a per-class model_config that clobbers the camelCase base, inline process models on
// BaseModel (422 on camelCase), and backend routes with no api.ts caller.

describe("schemaCasingIntegrityFailures", () => {
    const camelBase = `class CamelModel(BaseModel):\n    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)\n`;

    it("flags a schema that re-declares its own model_config", () => {
        const files: FileSpec[] = [
            { path: "backend/schemas.py", content: `${camelBase}\nclass ChildResponse(CamelModel):\n    id: str\n    model_config = ConfigDict(from_attributes=True)\n` },
        ];
        const f = schemaCasingIntegrityFailures(files);
        expect(f.some((x) => x.id.includes("ChildResponse"))).toBe(true);
    });

    it("passes when only CamelModel declares model_config", () => {
        const files: FileSpec[] = [
            { path: "backend/schemas.py", content: `${camelBase}\nclass ChildResponse(CamelModel):\n    id: str\n` },
        ];
        expect(schemaCasingIntegrityFailures(files)).toEqual([]);
    });
});

describe("inlineBaseModelFailures", () => {
    it("flags an inline request model on BaseModel", () => {
        const files: FileSpec[] = [
            { path: "backend/routers.py", content: `class DiagnoseRequest(BaseModel):\n    therapist_group_id: str\n` },
        ];
        const f = inlineBaseModelFailures(files);
        expect(f.some((x) => x.id.includes("DiagnoseRequest"))).toBe(true);
    });

    it("passes when inline models subclass CamelModel", () => {
        const files: FileSpec[] = [
            { path: "backend/routers.py", content: `class DiagnoseRequest(CamelModel):\n    therapist_group_id: str\n` },
        ];
        expect(inlineBaseModelFailures(files)).toEqual([]);
    });
});

describe("apiRouteCoverageFailures", () => {
    it("flags a backend route with no api.ts caller", () => {
        const files: FileSpec[] = [
            { path: "backend/routers.py", content: `@router.post("/children/{id}/diagnose-and-treat")\nasync def dt(): ...\n@router.get("/children")\nasync def list_children(): ...\n` },
            { path: "frontend/src/api.ts", content: "export const childAPI = { list: () => client.get('/children') }" },
        ];
        const f = apiRouteCoverageFailures(files);
        expect(f.some((x) => x.id.includes("diagnose-and-treat"))).toBe(true);
        expect(f.some((x) => x.id.includes("GET /children"))).toBe(false); // this one IS called
    });

    it("passes when every route is called (path params normalized)", () => {
        const files: FileSpec[] = [
            { path: "backend/routers.py", content: `@router.get("/children/{id}")\nasync def get_child(): ...\n` },
            { path: "frontend/src/api.ts", content: "export const childAPI = { get: (id) => client.get(`/children/${id}`) }" },
        ];
        expect(apiRouteCoverageFailures(files)).toEqual([]);
    });
});

describe("apiCallValidityFailures", () => {
    it("flags an api.ts call with no matching backend route (404 risk)", () => {
        const files: FileSpec[] = [
            { path: "backend/routers.py", content: `@router.get("/children")\nasync def list_children(): ...\n` },
            { path: "frontend/src/api.ts", content: "export const x = { go: () => client.post('/children/{id}/diagnose-and-treat') }" },
        ];
        const f = apiCallValidityFailures(files);
        expect(f.some((x) => x.id.includes("diagnose-and-treat"))).toBe(true);
    });

    it("passes when every call matches a route", () => {
        const files: FileSpec[] = [
            { path: "backend/routers.py", content: `@router.get("/children/{id}")\nasync def get_child(): ...\n` },
            { path: "frontend/src/api.ts", content: "export const x = { get: (id) => client.get(`/children/${id}`) }" },
        ];
        expect(apiCallValidityFailures(files)).toEqual([]);
    });
});

describe("modelColumnFailures", () => {
    // Regression for the run-5 boot-blocker: TherapistGroup used `id = String(36)` /
    // `id.primary_key = True` instead of Column(...), so SQLAlchemy found no PK.
    it("flags a bare-type column and a missing primary key", () => {
        const files: FileSpec[] = [
            { path: "backend/models.py", content: `class TherapistGroup(Base):\n    __tablename__ = "tg"\n    id = String(36)\n    name = String(255)\n` },
        ];
        const f = modelColumnFailures(files);
        expect(f.some((x) => x.id.includes("bare type"))).toBe(true);
        expect(f.some((x) => x.id.includes("no PK"))).toBe(true);
    });

    it("passes a well-formed model", () => {
        const files: FileSpec[] = [
            { path: "backend/models.py", content: `class Child(Base):\n    __tablename__ = "children"\n    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))\n    name = Column(String(255))\n` },
        ];
        expect(modelColumnFailures(files)).toEqual([]);
    });
});
