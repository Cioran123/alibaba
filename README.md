# Procurement Dept — agent-run supplier sourcing (Naïve hackathon)

Agents find Chinese hardware suppliers, reach out on Alibaba / email / WeChat, negotiate inside hard
authority limits, write a decision memo, pause for the founder's **proceed**, then send the follow-up.
Research and rationale: [research/sponsor-integration-report.md](research/sponsor-integration-report.md).

## Stack
- **Naïve** agents (`envoy` per supplier, `head` for the memo + `ask_operator`) calling our **MCP server** at `/api/mcp`
- **Mobilerun** phones: cloud Android (Alibaba.com app) + tethered iPhone (WeChat), driven by `scripts/32-poll-inboxes.ts`
- **AgentMail** email, **Apify** discovery, **OpenAI** vision/strict JSON, **OpenRouter** Qwen for Mandarin, **Neon** Postgres, **Vercel** hosting

## Runbook (in order)
```bash
cp .env.example .env.local        # fill keys as you get them
npm install
npm run script scripts/01-migrate.ts
npm run script scripts/00-smoke.ts            # add --phone / --apify for live checks
npm run script scripts/10-discover.ts -- --q "fall detection sensor module" --max 20
```
Deploy so Naïve can reach the MCP server and webhooks (public HTTPS required):
```bash
npx vercel link && npx vercel env pull .env.local && npx vercel --prod   # set PUBLIC_BASE_URL to the prod URL
```
Wave 1 (outreach) — post the Alibaba RFQ by hand first, then:
```bash
npm run script scripts/20-wave1-email.ts -- --limit 10
npm run script scripts/21-wave1-alibaba.ts -- --limit 8
npm run script scripts/22-wave1-wechat.ts -- --supplier 12 --remark "S012 Shenzhen XYZ"
```
Agents:
```bash
npm run script scripts/30-naive-setup.ts      # prints NAIVE_*_AGENT_ID + NAIVE_WEBHOOK_SECRET → .env.local + Vercel env
npm run script scripts/31-kickoff.ts          # Envoy session per conversation with replies (--all for every contacted supplier)
caffeinate -i npm run script scripts/32-poll-inboxes.ts   # all night: phone sends + inbox sweeps → Neon → wakes sessions
npm run script scripts/33-memo.ts             # Head writes the memo and asks the founder
```
Founder decides at `/ops` (or `POST /api/approve {approval_id, decision, note}`) → the Head session resumes and sends the follow-up.

## API for the frontend
| Route | Returns |
|---|---|
| `GET /api/pipeline` | `{stats, suppliers[{id,name,stage,channels,last_message,quote,session_id,message_count}]}` |
| `GET /api/suppliers/:id` | `{supplier, contacts, conversations[{channel, messages[{direction, body_original, body_en, ts}]}], quotes, jobs}` |
| `GET /api/memos` | `{memo:{markdown, ranked}, pending[{id, question}], approvals}` |
| `POST /api/approve` | body `{approval_id, decision: proceed\|counter\|reject, note?, supplier_id?}` |
| `GET /api/devices` | phones with `streamUrl` for the live embed |
All JSON with CORS `*`. Stages: `found → contacted → replied → negotiating → recommended → approved → ordered` (or `rejected`).

## Safety rails
- Agents never pay or commit: `propose_offer` enforces `authority_limits` in code; payment goes through Alibaba Trade Assurance by the founder.
- WeChat: real phone only, pre-seeded contacts, ≤30 sends/day, 45 s pacing, stops on any security prompt.
- Supplier text is fenced as untrusted before it reaches an agent.
