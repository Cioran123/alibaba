const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...CORS, ...(init.headers || {}) } });
}

export function options() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Parse JSON or form-encoded bodies. */
export async function readBody(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await req.json()) ?? {};
  if (ct.includes("form")) return Object.fromEntries((await req.formData()).entries());
  const t = await req.text();
  try { return JSON.parse(t); } catch { return {}; }
}
