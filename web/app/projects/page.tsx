import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ProjectsClient from "./projects-client";

export default async function ProjectsPage() {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok") redirect("/login");
    return <ProjectsClient />;
}
