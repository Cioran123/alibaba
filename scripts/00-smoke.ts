// Hour-1 smoke test. Run: npm run script scripts/00-smoke.ts [--apify] [--phone]
export {};
const flags = new Set(process.argv.slice(2));
const ok = (k: string, v: unknown) => console.log(`✅ ${k}:`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 300));
const bad = (k: string, e: unknown) => console.log(`❌ ${k}:`, (e as any)?.message ?? e);

// Naive
try {
  const { naive } = await import("../lib/naive");
  const models = await naive.models.list({ limit: 50 } as any);
  const ids = models.data.map((m) => m.id);
  ok("naive.models", `${ids.length} models; e.g. ${ids.slice(0, 8).join(", ")}`);
  const pick = ids.find((i) => /claude|gpt|qwen|glm|deepseek|kimi/i.test(i));
  if (!process.env.NAIVE_MODEL) console.log(`   → set NAIVE_MODEL (suggestion: ${pick ?? ids[0]})`);
  const h = await naive.harnesses.list();
  ok("naive.harnesses", (h as any).data?.map((x: any) => x.id ?? x.name));
} catch (e) { bad("naive", e); }

// Neon
try {
  const { sql } = await import("../lib/db");
  const [r] = await sql`select count(*)::int as n from suppliers`;
  ok("neon", `suppliers=${r.n}`);
} catch (e) { bad("neon (run scripts/01-migrate.ts first?)", e); }

// Mobilerun
try {
  const { listDevices } = await import("../lib/mobilerun");
  const d = await listDevices();
  ok("mobilerun.devices", d);
  if (flags.has("--phone")) {
    const { runTaskAndWait, DEVICES } = await import("../lib/mobilerun");
    const dev = DEVICES.android || d[0]?.id;
    const r = await runTaskAndWait({ deviceId: dev, task: "Open the Settings app and return the device name shown at the top as {name}.", outputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, maxSteps: 12, timeoutSec: 180 }, { onStatus: (s) => console.log("   mobilerun:", s) });
    ok("mobilerun.task", r);
  }
} catch (e) { bad("mobilerun", e); }

// AgentMail
try {
  const { agentmail, INBOX } = await import("../lib/agentmail");
  const inboxes: any = await agentmail.inboxes.list();
  ok("agentmail.inboxes", (inboxes.inboxes ?? inboxes.data ?? []).map((i: any) => i.inboxId));
  if (!INBOX) console.log("   → set AGENTMAIL_INBOX_ID");
} catch (e) { bad("agentmail", e); }

// Apify
try {
  const { apify, ACTORS } = await import("../lib/apify");
  const me: any = await apify.user().get();
  ok("apify.user", me.username ?? me.id);
  if (flags.has("--apify")) {
    const { runActor } = await import("../lib/apify");
    const items = await runActor(ACTORS.alibabaSuppliers, { searchTerms: ["fall detection sensor"], maxSuppliersPerSearch: 5 }, { maxItems: 5, timeoutSecs: 180 });
    ok("apify.alibaba", { n: items.length, keys: Object.keys(items[0] ?? {}) });
  }
} catch (e) { bad("apify", e); }

// OpenAI + OpenRouter
try {
  const { extractQuoteFromText, draftZh } = await import("../lib/llm");
  const q = await extractQuoteFromText("您好，60GHz雷达模组单价 ¥85/pcs，起订量500，交期15天，样品费200元可退，CE/FCC有报告。30%定金。");
  ok("openai.extract", q);
  const z = await draftZh("Ask for 1000-pc price tier and CE/FCC test report", "Supplier: Shenzhen XYZ. Product: 60GHz mmWave fall-detection module.");
  ok("openrouter.draft_zh", z);
} catch (e) { bad("llm", e); }
