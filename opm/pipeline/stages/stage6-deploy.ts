// Stage 6: Deploy to cloud (GitHub + Railway)
// Creates a new public GitHub repo, pushes the generated project, then
// creates a Railway project linked to that repo with a Postgres plugin.
// Returns public URLs.
//
// If tokens are missing, returns a no-op placeholder so the pipeline still
// completes cleanly.

import { createRepo, pushProjectFiles } from "@/web/deploy/github";
import { deployFromGitHub }             from "@/web/deploy/railway";
import { getToken }                     from "@/web/auth/oauth-tokens";

export type DeployOutput = {
    skipped?:      boolean;
    reason?:       string;
    github?:       { owner: string; repo: string; html_url: string; commitSha: string; files: number };
    railway?:      { projectId: string; railwayUrl: string; backendUrl?: string; frontendUrl?: string };
};

function shortId() {
    return Math.random().toString(36).slice(2, 8);
}

function safeRepoName(base: string) {
    const slug = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    return `opm-${slug.slice(0, 40)}-${shortId()}`;
}

export async function deployToCloud_stage6(input: {
    jobId:      string;
    filename:   string;
    outputDir?: string;
    userId?:    string;   // owner whose GitHub + Railway accounts we deploy to
}): Promise<DeployOutput> {
    if (!input.outputDir) {
        return { skipped: true, reason: "no generated project directory" };
    }
    if (!input.userId) {
        return { skipped: true, reason: "Sign in to deploy" };
    }

    // Pull this user's connected credentials. Either missing → skip cleanly so
    // the pipeline still completes; the UI prompts them to connect.
    const github = await getToken(input.userId, "github");
    if (!github) return { skipped: true, reason: "GitHub not connected" };
    const railway = await getToken(input.userId, "railway");
    if (!railway) return { skipped: true, reason: "Railway not connected" };

    const repoName = safeRepoName(input.filename.replace(/\.[^.]+$/, ""));

    // 1. Create GitHub repo (under the user's own account)
    const repo = await createRepo(github.token, repoName);

    // 2. Push project
    const push = await pushProjectFiles(github.token, repo, input.outputDir);

    // 3. Railway project + services
    const deploy = await deployFromGitHub({
        token:       railway.token,
        projectName: repoName,
        githubOwner: repo.owner,
        githubRepo:  repo.repo,
    });

    return {
        github: {
            owner:     repo.owner,
            repo:      repo.repo,
            html_url:  repo.html_url,
            commitSha: push.commitSha,
            files:     push.filesPushed,
        },
        railway: {
            projectId:   deploy.projectId,
            railwayUrl:  deploy.railwayUrl,
            backendUrl:  deploy.backendUrl,
            frontendUrl: deploy.frontendUrl,
        },
    };
}
