/**
 * web/auth/session.ts — cookie helpers shared by the auth + deploy routes.
 *
 * Login sets two cookies (see app/api/login/route.ts):
 *   session = "ok"                       (httpOnly gate)
 *   uid     = JSON.stringify({id,name,email})  (readable by the client)
 */

/** Parse the `uid` cookie value → user id. Always null-safe. */
export function userIdFromCookie(raw: string | undefined): string | undefined {
    try {
        return raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
    } catch {
        return undefined;
    }
}
