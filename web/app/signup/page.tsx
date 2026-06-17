import { cookies }  from "next/headers";
import { redirect } from "next/navigation";
import SignupClient  from "./signup-client";

export default async function SignupPage() {
    const jar = await cookies();
    // Already logged in → go straight to projects
    if (jar.get("session")?.value === "ok") redirect("/projects");
    return <SignupClient />;
}
