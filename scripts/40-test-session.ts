// Integration test: start an Envoy session that must call our MCP ledger_read and end its turn without sending anything.
// Run: npm run script scripts/40-test-session.ts -- [--supplier 24]
import { naive, startSession } from "../lib/naive";
const argv = process.argv.slice(2);
const sid = Number(argv[argv.indexOf("--supplier") + 1] || 24);
const agent = process.env.NAIVE_ENVOY_AGENT_ID!;
const s = await startSession(agent, `TEST RUN (no outreach). Call ledger_read(supplier_id=${sid}), then call propose_offer with unit_price_usd=12 and moq=500, then call draft_zh with intent "ask for 1000-pc price tier" (do NOT send anything), and finish with STATUS: closed — <one line summary of what ledger_read returned and what propose_offer said>.`, { test: true });
console.log("session", s.id, s.status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let after = 0;
for (let i = 0; i < 120; i++) {
  await sleep(3000);
  const ev: any = await naive.sessions.events(s.id, { after_seq: after, limit: 100 } as any);
  for (const e of ev.data ?? []) {
    after = Math.max(after, e.seq ?? after);
    const t = e.type ?? e.event;
    if (/tool\.(started|completed|confirm)|message\.completed|session\.(idle|degraded|retrying)|budget/.test(t)) {
      const d = e.data ?? e;
      const name = d.name ?? d.tool ?? d.tool_name ?? "";
      const text = (d.text ?? d.content ?? d.result ?? d.output ?? d.error ?? "").toString().slice(0, 300).replace(/\n/g, " ");
      console.log(`[${e.seq}] ${t} ${name} ${text}`);
    }
  }
  const st: any = await naive.sessions.get(s.id);
  if (st.status !== "running" && st.status !== "queued") {
    console.log("\nFINAL status:", st.status, "stop_reason:", st.stop_reason, "stop_code:", st.stop_code ?? "");
    if (st.pending_actions?.length) console.log("pending_actions:", JSON.stringify(st.pending_actions).slice(0, 800));
    console.log("spend:", JSON.stringify(st.spend ?? st.usage ?? {}).slice(0, 200));
    break;
  }
}
