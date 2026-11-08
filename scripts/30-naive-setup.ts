// Create (or update) the Naive agents, the vault credential for our MCP server, and the session.idle webhook.
// Run: npm run script scripts/30-naive-setup.ts            (creates; prints env lines to add)
//      npm run script scripts/30-naive-setup.ts -- --update (pushes prompt/tool changes to existing agents)
import { readFileSync } from "node:fs";
import { naive } from "../lib/naive";

const BASE = process.env.PUBLIC_BASE_URL;
const MODEL = process.env.NAIVE_MODEL;
if (!BASE || !MODEL) throw new Error("PUBLIC_BASE_URL and NAIVE_MODEL are required");
// The secret rides in the URL unless --vault is passed (vault credentials need an admin-scoped key).
const MCP_URL = process.argv.includes("--vault")
  ? `${BASE.replace(/\/$/, "")}/api/mcp`
  : `${BASE.replace(/\/$/, "")}/api/mcp?key=${process.env.MCP_SHARED_SECRET}`;
const UPDATE = process.argv.includes("--update");

const fill = (f: string) =>
  readFileSync(new URL(`../naive/prompts/${f}`, import.meta.url), "utf8")
    .replaceAll("{{COMPANY}}", process.env.COMPANY_NAME || "Sentinel Care")
    .replaceAll("{{FOUNDER_NAME}}", process.env.FOUNDER_NAME || "the founder");

const ENVOY_TOOLS = ["ledger_read", "draft_zh", "email_send", "alibaba_send", "wechat_send", "record_quote", "propose_offer"];
const HEAD_TOOLS = [...ENVOY_TOOLS, "memo_compose"];

const tools = (allowed: string[], extra: Record<string, any>) => ({
  default_config: { permission: "deny" as const },
  configs: {
    ...Object.fromEntries(allowed.map((t) => [`procops.${t}`, { enabled: true, permission: "allow" as const }])),
    ...extra,
  },
});

const budget = { cap_micro_usd: 20_000_000, max_task_micro_usd: 2_000_000, period: "day" as const };
// Naive requires an email when any notification is enabled; without FOUNDER_EMAIL our webhook + /ops carry the approvals.
const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL || null;
const notifications = FOUNDER_EMAIL
  ? { email: FOUNDER_EMAIL, approvals: true, questions: true, updates: false }
  : { email: null, approvals: false, questions: false, updates: false };
const mcp_servers = [{ type: "url" as const, name: "procops", url: MCP_URL }];

const envoyBody = {
  name: "procurement-envoy", harness: "pi" as const, model: MODEL, window: "immediate" as const,
  system: fill("envoy.md"),
  tools: tools(ENVOY_TOOLS, { ask_operator: { enabled: false, permission: "deny" } }),
  mcp_servers, budget, notifications,
  description: "Negotiates with one Chinese supplier per session (Alibaba chat, email, WeChat) inside hard authority limits.",
};
const headBody = {
  name: "procurement-head", harness: "pi" as const, model: MODEL, window: "immediate" as const,
  system: fill("head.md"),
  tools: tools(HEAD_TOOLS, { ask_operator: { enabled: true, permission: "ask" } }),
  mcp_servers, budget, notifications,
  description: "Writes the decision memo and asks the founder to proceed / counter / reject, then sends the follow-up.",
};

if (UPDATE) {
  const e = process.env.NAIVE_ENVOY_AGENT_ID, h = process.env.NAIVE_HEAD_AGENT_ID;
  if (!e || !h) throw new Error("set NAIVE_ENVOY_AGENT_ID and NAIVE_HEAD_AGENT_ID to update");
  const ev = await naive.agents.update(e, envoyBody as any);
  const hd = await naive.agents.update(h, headBody as any);
  console.log("updated envoy", ev.id, "v", (ev as any).version, "| head", hd.id, "v", (hd as any).version);
  process.exit(0);
}

// 1) Vault credential: Naive injects it as the bearer for our MCP URL. Needs an `admin`-scoped key.
//    --skip-vault: create agents + webhook now, add the credential later with --vault-only.
const VAULT_ONLY = process.argv.includes("--vault-only");
if (process.argv.includes("--vault")) {
  const vault = await naive.vaults.create({ display_name: "procurement-ops" } as any);
  const cred = await naive.vaults.credentials.create(vault.id, { kind: "static_bearer", key: "procops", value: process.env.MCP_SHARED_SECRET!, mcp_server_url: MCP_URL } as any);
  console.log("vault", vault.id, "credential", cred.id, "→", MCP_URL);
  if (VAULT_ONLY) process.exit(0);
}

// 2) Agents
const envoy = await naive.agents.create(envoyBody as any);
console.log("envoy agent", envoy.id);
const head = await naive.agents.create(headBody as any);
console.log("head agent", head.id);

// 3) Webhook (secret shown once)
const wh = await naive.webhooks.create({ url: `${BASE.replace(/\/$/, "")}/api/webhooks/naive`, events: ["session.idle", "budget.exceeded"] });
console.log("webhook", wh.id);

console.log("\nAdd to .env.local (and Vercel env):");
console.log(`NAIVE_ENVOY_AGENT_ID=${envoy.id}`);
console.log(`NAIVE_HEAD_AGENT_ID=${head.id}`);
console.log(`NAIVE_WEBHOOK_SECRET=${wh.secret}`);
