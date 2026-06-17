// GitHub bot operations — create repo, push generated files.
// Uses the Contents API (no Git CLI needed inside a Next server).

import { Octokit } from "@octokit/rest";
import fs from "node:fs/promises";
import path from "node:path";

function client(token: string) {
    if (!token) throw new Error("GitHub token missing");
    return new Octokit({ auth: token });
}

export type RepoInfo = {
    owner: string;
    repo:  string;
    html_url: string;
    clone_url: string;
    default_branch: string;
};

export async function createRepo(token: string, name: string): Promise<RepoInfo> {
    const gh    = client(token);
    const res   = await gh.repos.createForAuthenticatedUser({
        name,
        private:       false,
        description:   "Auto-generated full-stack project from an OPM diagram",
        auto_init:     true,       // creates initial commit + main branch
        default_branch: "main",
    });
    // Owner is whichever account the token authenticates as — read it back from
    // the API response rather than trusting a separately-stored login.
    return {
        owner:          res.data.owner.login,
        repo:           res.data.name,
        html_url:       res.data.html_url,
        clone_url:      res.data.clone_url,
        default_branch: res.data.default_branch ?? "main",
    };
}

// Walk a directory, return [{ relPath, content }] — skips node_modules, .git.
async function collectFiles(dir: string, base = dir): Promise<{ rel: string; content: Buffer }[]> {
    const out: { rel: string; content: Buffer }[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...await collectFiles(full, base));
        else {
            const buf = await fs.readFile(full);
            out.push({ rel: path.relative(base, full).replace(/\\/g, "/"), content: buf });
        }
    }
    return out;
}

// Push every file under projectDir to the repo's main branch in a single
// commit using a tree create (faster + atomic vs file-by-file).
export async function pushProjectFiles(token: string, repo: RepoInfo, projectDir: string) {
    const gh    = client(token);
    const owner = repo.owner;
    const name  = repo.repo;

    // 1. Get the current main branch SHA
    const ref = await gh.git.getRef({ owner, repo: name, ref: `heads/${repo.default_branch}` });
    const baseSha = ref.data.object.sha;

    // 2. Collect files and upload each as a blob
    const files = await collectFiles(projectDir);
    const blobs: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    for (const f of files) {
        const b = await gh.git.createBlob({
            owner,
            repo: name,
            content:  f.content.toString("base64"),
            encoding: "base64",
        });
        blobs.push({ path: f.rel, mode: "100644", type: "blob", sha: b.data.sha });
    }

    // 3. Create a tree containing all blobs
    const tree = await gh.git.createTree({
        owner,
        repo: name,
        base_tree: baseSha,
        tree: blobs,
    });

    // 4. Create a commit pointing at the tree
    const commit = await gh.git.createCommit({
        owner,
        repo:    name,
        message: "feat: initial generation from OPM diagram",
        tree:    tree.data.sha,
        parents: [baseSha],
    });

    // 5. Move the ref forward
    await gh.git.updateRef({
        owner,
        repo: name,
        ref:  `heads/${repo.default_branch}`,
        sha:  commit.data.sha,
    });

    return { commitSha: commit.data.sha, filesPushed: files.length };
}
