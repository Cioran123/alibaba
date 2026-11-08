/**
 * Minimal guard for the founder-facing surfaces (/ops, /api/approve) when the app is reachable publicly.
 * Set DASHBOARD_TOKEN; pass it as `?token=`, a `dashboard_token` cookie, or `Authorization: Bearer`.
 * Unset → open (local dev).
 */
export function dashboardAuthorized(req: Request): boolean {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("token") === token) return true;
  if ((req.headers.get("authorization") || "") === `Bearer ${token}`) return true;
  const cookie = req.headers.get("cookie") || "";
  return cookie.split(";").some((c) => c.trim() === `dashboard_token=${token}`);
}

export function unauthorized() {
  return new Response("unauthorized — add ?token=<DASHBOARD_TOKEN>", { status: 401 });
}
