import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";

export default async function Dashboard({
    searchParams,
}: {
    searchParams: Promise<{ job?: string }>;
}) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok") redirect("/login");
    const params = await searchParams;
    return <DashboardClient initialJobId={params.job} />;
}
