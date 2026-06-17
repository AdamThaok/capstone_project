import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = request.cookies.get("session")?.value;

  if ((path.startsWith("/dashboard") || path.startsWith("/projects")) && session !== "ok") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (path === "/login" && session === "ok") {
    return NextResponse.redirect(new URL("/projects", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
