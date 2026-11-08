import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Ops({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const required = process.env.DASHBOARD_TOKEN;
  if (required && token !== required) return <main><h1>401</h1><p>Open /ops?token=&lt;DASHBOARD_TOKEN&gt;</p></main>;
  const suppliers = await sql`
    select s.id, s.name, s.stage, s.source,
      (select string_agg(c.channel, ',') from supplier_contacts c where c.supplier_id = s.id) as channels,
      (select left(coalesce(m.body_en, m.body_original), 110) from messages m join conversations cv on cv.id = m.conversation_id where cv.supplier_id = s.id order by m.ts desc limit 1) as last,
      (select cv.naive_session_id from conversations cv where cv.supplier_id = s.id and cv.naive_session_id is not null limit 1) as session
    from suppliers s where s.stage <> 'found' order by s.updated_at desc`;
  const pending = await sql`select a.id, a.naive_session_id, a.question, a.created_at, m.markdown from approvals a left join decision_memos m on m.id = a.memo_id where a.decision is null order by a.id desc`;
  const jobs = await sql`select id, kind, status, error, left(payload->>'contact', 30) as contact, created_at from device_jobs order by id desc limit 12`;
  const msgs = await sql`select m.ts, cv.channel, m.direction, s.name, left(coalesce(m.body_en, m.body_original), 140) as text from messages m join conversations cv on cv.id = m.conversation_id join suppliers s on s.id = cv.supplier_id order by m.ts desc limit 30`;
  const td = { padding: "4px 8px", borderBottom: "1px solid #ddd", verticalAlign: "top", fontSize: 13 } as const;
  return (
    <main>
      <h1>Procurement ops</h1>
      <h2>Pending founder decisions ({pending.length})</h2>
      {pending.map((p: any) => (
        <div key={p.id} style={{ border: "1px solid #999", padding: 12, marginBottom: 12 }}>
          <div><b>#{p.id}</b> session {p.naive_session_id} · {new Date(p.created_at).toLocaleString()}</div>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto", background: "#f6f6f6", padding: 8 }}>{p.markdown ?? JSON.stringify(p.question?.question ?? p.question, null, 1)}</pre>
          <form method="post" action={`/api/approve${required ? `?token=${required}` : ""}`} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="approval_id" value={p.id} />
            <input name="note" placeholder="note for the agent (optional)" style={{ flex: 1 }} />
            <button name="decision" value="proceed">Proceed</button>
            <button name="decision" value="counter">Counter</button>
            <button name="decision" value="reject">Reject</button>
          </form>
        </div>
      ))}
      <h2>Pipeline ({suppliers.length} contacted)</h2>
      <table style={{ borderCollapse: "collapse" }}><thead><tr>{["id", "supplier", "stage", "channels", "last message", "session"].map((h) => <th key={h} style={td}>{h}</th>)}</tr></thead>
        <tbody>{suppliers.map((s: any) => <tr key={s.id}><td style={td}>{s.id}</td><td style={td}><a href={`/api/suppliers/${s.id}`}>{s.name}</a></td><td style={td}><b>{s.stage}</b></td><td style={td}>{s.channels}</td><td style={td}>{s.last}</td><td style={td}>{s.session}</td></tr>)}</tbody></table>
      <h2>Phone jobs</h2>
      <table style={{ borderCollapse: "collapse" }}><tbody>{jobs.map((j: any) => <tr key={j.id}><td style={td}>{j.id}</td><td style={td}>{j.kind}</td><td style={td}>{j.contact}</td><td style={td}>{j.status}</td><td style={td}>{j.error}</td><td style={td}>{new Date(j.created_at).toLocaleTimeString()}</td></tr>)}</tbody></table>
      <h2>Recent messages</h2>
      <table style={{ borderCollapse: "collapse" }}><tbody>{msgs.map((m: any, i: number) => <tr key={i}><td style={td}>{new Date(m.ts).toLocaleTimeString()}</td><td style={td}>{m.channel}</td><td style={td}>{m.direction === "in" ? "⬅️" : "➡️"}</td><td style={td}>{m.name}</td><td style={td}>{m.text}</td></tr>)}</tbody></table>
    </main>
  );
}
