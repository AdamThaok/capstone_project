// Railway GraphQL API client.
// Docs: https://docs.railway.com/reference/public-api

const ENDPOINT = "https://backboard.railway.app/graphql/v2";

async function gql<T = unknown>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!token) throw new Error("Railway token missing");
    const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
        throw new Error("Railway: " + json.errors.map((e) => e.message).join("; "));
    }
    if (!json.data) throw new Error("Railway: empty response");
    return json.data;
}

export type DeployResult = {
    projectId:      string;
    environmentId:  string;
    backendUrl?:    string;
    frontendUrl?:   string;
    railwayUrl:     string;   // URL to Railway dashboard
};

async function getDefaultEnvironmentId(token: string, projectId: string): Promise<string> {
    const data = await gql<{ project: { environments: { edges: { node: { id: string; name: string } }[] } } }>(token, `
        query($id: String!) {
            project(id: $id) {
                environments {
                    edges { node { id name } }
                }
            }
        }
    `, { id: projectId });
    const envs = data.project.environments.edges.map((e) => e.node);
    const prod = envs.find((e) => e.name === "production") ?? envs[0];
    if (!prod) throw new Error("Railway: no environment on new project");
    return prod.id;
}

// Deploys a GitHub repo to a new Railway project + Postgres.
// Railway auto-detects the Dockerfile in each service root.
export async function deployFromGitHub(input: {
    token:       string;
    projectName: string;
    githubOwner: string;
    githubRepo:  string;
}): Promise<DeployResult> {
    const { token } = input;

    // 1. Create project
    const created = await gql<{ projectCreate: { id: string } }>(token, `
        mutation($input: ProjectCreateInput!) {
            projectCreate(input: $input) { id }
        }
    `, { input: { name: input.projectName, defaultEnvironmentName: "production" } });
    const projectId = created.projectCreate.id;
    const environmentId = await getDefaultEnvironmentId(token, projectId);

    // 2. Create Postgres database via the database-create mutation.
    //    Use templateServiceCreate with the official postgres template.
    //    Railway publishes a canonical POSTGRES template id.
    try {
        await gql(token, `
            mutation($input: TemplateDeployV2Input!) {
                templateDeployV2(input: $input) { workflowId projectId }
            }
        `, {
            input: {
                projectId,
                environmentId,
                serializedConfig: {
                    services: {
                        "postgres": {
                            source: { image: "postgres:15" },
                            variables: {
                                POSTGRES_USER:     "${{RANDOM_STRING(16)}}",
                                POSTGRES_PASSWORD: "${{RANDOM_STRING(32)}}",
                                POSTGRES_DB:       "railway",
                            },
                            volumes: [{ mountPath: "/var/lib/postgresql/data", name: "pgdata" }],
                        },
                    },
                    templateId: null,
                },
            },
        });
    } catch (e) {
        console.warn("[railway] Postgres template deploy failed; continuing without DB:", (e as Error).message);
    }

    // 3. Create two services (backend, frontend) both pointing at the
    //    same GitHub repo but with different root directories so Railway
    //    finds each Dockerfile separately.
    async function createService(name: string, rootDir: string) {
        const d = await gql<{ serviceCreate: { id: string } }>(token, `
            mutation($input: ServiceCreateInput!) {
                serviceCreate(input: $input) { id }
            }
        `, {
            input: {
                projectId,
                name,
                source: {
                    repo:    `${input.githubOwner}/${input.githubRepo}`,
                    rootDirectory: rootDir,
                },
            },
        });
        return d.serviceCreate.id;
    }

    let backendServiceId: string | undefined;
    let frontendServiceId: string | undefined;
    try {
        backendServiceId  = await createService(`${input.projectName}-backend`,  "backend");
        frontendServiceId = await createService(`${input.projectName}-frontend`, "frontend");
    } catch (e) {
        console.warn("[railway] service create partial failure:", (e as Error).message);
    }

    // 3b. Wire the backend to the Postgres service. Without this the backend boots
    //     but has no DATABASE_URL and can't connect. We build the URL from the
    //     postgres service's own variables + private network domain, and bake in
    //     the async driver (+asyncpg) so SQLAlchemy's create_async_engine works.
    async function setServiceVariable(serviceId: string, name: string, value: string) {
        try {
            await gql(token, `
                mutation($input: VariableUpsertInput!) {
                    variableUpsert(input: $input)
                }
            `, { input: { projectId, environmentId, serviceId, name, value } });
        } catch (e) {
            console.warn(`[railway] variableUpsert ${name} failed:`, (e as Error).message);
        }
    }

    if (backendServiceId) {
        // References resolve at deploy time against the "postgres" service created above.
        const dbUrl =
            "postgresql+asyncpg://${{postgres.POSTGRES_USER}}:${{postgres.POSTGRES_PASSWORD}}" +
            "@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{postgres.POSTGRES_DB}}";
        await setServiceVariable(backendServiceId, "DATABASE_URL", dbUrl);
    }

    // 4. Generate a public domain for each service.
    async function generateDomain(serviceId: string) {
        try {
            const d = await gql<{ serviceDomainCreate: { domain: string } }>(token, `
                mutation($input: ServiceDomainCreateInput!) {
                    serviceDomainCreate(input: $input) { domain }
                }
            `, { input: { serviceId, environmentId } });
            return d.serviceDomainCreate.domain;
        } catch (e) {
            console.warn(`[railway] domain create failed for ${serviceId}:`, (e as Error).message);
            return undefined;
        }
    }

    const backendDomain  = backendServiceId  ? await generateDomain(backendServiceId)  : undefined;
    const frontendDomain = frontendServiceId ? await generateDomain(frontendServiceId) : undefined;

    return {
        projectId,
        environmentId,
        backendUrl:  backendDomain  ? `https://${backendDomain}`  : undefined,
        frontendUrl: frontendDomain ? `https://${frontendDomain}` : undefined,
        railwayUrl:  `https://railway.app/project/${projectId}`,
    };
}
