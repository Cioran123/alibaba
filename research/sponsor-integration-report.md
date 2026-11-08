# Agent Procurement Department: Architecture and Battle Plan
*Naive Autonomous Company Hackathon, YC SF, Nov 7-8 2026. Lead-architect synthesis of 7 research tracks.*


> **Verification notes (added Sat 22:30 PST, after spot-checking the load-bearing claims against primary docs)**
> - **Confirmed:** `ask_operator` exists ("the tool is the pause, so allow collapses to ask"); `POST /v1/sessions/{id}/answers` resumes it; `POST /v1/sessions/{id}/tool_confirmations` resolves held tools; `stop_reason` values `awaiting_answer` / `awaiting_approval` are real; `POST /v1/sessions/{id}/messages` (202) resumes an idle session. Sources: usenaive.ai/docs/api/sessions.md, docs/capabilities/tools.md.
> - **Confirmed:** custom tools are "coming soon"; `mcp_servers` must be public HTTPS (localhost/private IPs refused with 400), max 20 per agent, auth only via vault `static_bearer` / `mcp_oauth`, inline `Authorization` headers rejected, MCP tools default to `ask`.
> - **Confirmed verbatim:** "Reading contacts, mail, messages or a connected app flags the chat" and then "every send, board_write, mobile, data_run ... every connected-app or MCP tool ask, each time, even at allow." Keep Scout and Envoy as separate agents, and test in the first hour whether a relay-injected `sessions.send` message trips the flag.
> - **Confirmed:** Mobilerun MCP at `https://api.mobilerun.ai/v1/mcp`, `Authorization: Bearer dr_sk_...`, tools include `run_task`, `get_task`, `get_device_ui_state`, `get_device_screenshot`, `manage_device_apps`, `manage_device_files`; `humanize` is a real option; the iOS device type id is `ios_phone`.
> - **Correction:** Mobilerun's device-types doc lists only **Android Phone** (virtual, EU-hosted, $50/mo, "full state persistence across sessions") and **Personal Phone** (bring your own Android or iPhone, $5/mo). Hosted iPhones appear to be a hackathon-specific arrangement; confirm at the booth. The emulator-ban concern for WeChat on a virtual Android comes from WeChat's help-center block reasons, not from any reported Mobilerun case.
> - **Timing correction:** it is now **Sat 22:30 PST = Sun 14:30 Shenzhen**, and hacking stops **Sun 11:00 PST = Mon 03:00 Shenzhen**. Section 6 below was rewritten for the ~12.5 hours that remain. Shenzhen is awake for roughly 7 more hours (until ~Sun 06:00 PST); after that, no real replies until after judging.

---

## 1. TL;DR

**Recommended stack**
- **Naive is the runtime and governance layer.** All agents run on the `pi` harness, because `claude_code` and `hermes` cannot hold approvals. Use a Team (coordinator plus roster) with a board, budgets, deployments (cron) and `session.idle` webhooks. **Correction to our brief:** Naive does have a human-in-the-loop primitive. `ask_operator` parks a session on `awaiting_answer`, and `POST /v1/sessions/{id}/answers` resumes it. Tools set to `ask` park on `awaiting_approval`.
- **One custom MCP server, `procurement-ops`, hosted on Vercel.** It is the only way to add our own tools, since client-side custom tools are "coming soon". It wraps Mobilerun (WeChat and the Alibaba app), Apify, AgentMail, OpenAI vision and Neon. It also enforces the hard authority limits in code, not in the prompt.
- **Mobilerun is the hands on a phone.** WeChat runs on real hardware only: a teammate's physical Android connected through the Mobilerun Portal, or a Mobilerun physical iPhone. The Alibaba.com app runs on a separate Mobilerun device. Never put WeChat on Naive's built-in `mobile` tool, which is disposable, or on a Mobilerun virtual Android, which risks an emulator ban.
- **Apify handles discovery.** Use `rel8ble/alibaba-supplier-search-scraper` with `silentflow/alibaba-scraper` as fallback, `lentic_clockss/1688-global-scraper` (it can return published mobile numbers), and `scrapesage/made-in-china-scraper`, normalized into one `find_suppliers` tool.
- **AgentMail carries supplier email** and is the system of record. Its `thread_id` maps to a Naive session through a webhook relay. **Naive Identity email** goes to the founder, or we use AgentMail for that too.
- **Neon is the single source of truth:** suppliers, threads, messages, quotes, authority limits, approvals, and the `thread → session_id` routing table.
- **Vercel hosts** the dashboard (a strong Best Design surface), the MCP server, and the webhook relay. **Render** ($7 Starter worker) runs the always-on WeChat bridge, which serializes one-task-per-device phone jobs.
- **Models:**
  - Naive catalogue model for the agents. Confirm ids with `naive models list`.
  - OpenAI called directly from our MCP server for vision and strict-JSON memo work, because Naive's proxy rejects images and `response_format`.
  - OpenRouter Qwen/GLM/DeepSeek for idiomatic Mandarin drafting and parsing.
- **Optional:** Stripe for a Payment Link and Issuing in sandbox. HubSpot as a one-way mirror. GPT-Live outbound voice as a stretch goal. **Skip Luxor.**

**Single best supplier-outreach route for a real demo:**
> **Alibaba.com buyer chat plus one free RFQ** gives first contact and the highest chance of real replies. It is driven by the Alibaba app on a Mobilerun phone, with the Naive browser as backup. Suppliers then hand off to **personal WeChat on a real phone driven by Mobilerun**, where the negotiation happens. Every agreed term is mirrored to **AgentMail email** for the record. Two or three **pre-seeded friendly WeChat contacts** are the demo backstop.

**Time-zone reality check.** This is arithmetic, and it matters. PST is UTC−8 and Shenzhen is UTC+8, a 16-hour gap. Sat 18:00 SF is **Sunday** 10:00 in Shenzhen, and Sun 09:00 SF is Monday 01:00 in Shenzhen. So the overnight window is Chinese Sunday daytime: you will get some replies (WeChat, auto-replies, weekend reps), but fewer than on a weekday. Chinese Monday business hours start Sun ~17:00 SF, which is probably after judging. Send early, post the RFQ as soon as possible, and pre-seed contacts.

---

## 2. Supplier channel verdict

| # | Channel | Realism for demo | Automation method | Sponsor tool | Risk | Recommendation |
|---|---|---|---|---|---|---|
| 1 | **Alibaba.com Message Center + free RFQ** | **Highest real-reply odds.** Alibaba cites ~10-15 RFQ quotes. Most export electronics ODMs live here. | UI automation only. **No public buyer messaging API was found**; the Open Platform needs GGS app review. Use the Alibaba app on a Mobilerun device (Mobilerun has an Alibaba app-agent guide) or the Naive browser with a saved login. | Mobilerun, Naive browser, Apify (discovery) | Moderate. ToS bans "automatic devices" retrieval and allows related-account suspension. Expect captchas and sliders on the web. | **MUST. First contact plus RFQ.** Ask for the rep's WeChat in message one. |
| 2 | **Email** | High as a paper trail. Slower replies. | Fully API-driven. | **AgentMail** (or Naive Identity email) | Low-moderate. AgentMail ToS says "does not support cold outreach". QQ/163 deliverability is undocumented. | **MUST.** System of record. Mirror every term agreed on WeChat or Alibaba. |
| 3 | **Personal WeChat on a real phone** | Most authentic and best for judges. It is what Chinese reps actually use, and they reply on weekends. | Mobilerun UI automation (`run_task` + `outputSchema`) on **real hardware**. | **Mobilerun** | Low-moderate at low volume on an established account. **High** on a virtual Android or a new account. | **MUST** for the core story and the Mobile track. |
| 4 | **WeCom 微信客服 (kf) API** | Only works after the supplier clicks our link or scans our QR. Conversion rate unknown. | Official API: `kf/send_msg` allows max 5 messages per 48h after each inbound message. `kf/sync_msg` plus a callback. | (Vercel callback) | Low ToS risk. It is unclear whether an **unverified** overseas org can send at all: error `8-主体未验证` exists, and the reported cap is 100 customers. | **SHOULD try in hour 1.** If it works, it is the "scales compliantly" slide. Do not depend on it. |
| 5 | Made-in-China / Global Sources inquiries | Medium. Good vetting data (free SGS/BV audit reports). | Browser automation. Apify for discovery. | Apify, Naive browser | ToS likely similar to Alibaba (not read). | **SHOULD.** Discovery and vetting. Outreach only if time allows. |
| 6 | WhatsApp Cloud API | Low-medium. Blocked in mainland China, so suppliers need a VPN or HK number. | Official API. Cold contact needs a template. | none (Twilio optional) | Low with the official API. | **NICE.** Fallback only. |
| 7 | Phone (PSTN to +86) | Low for cold calls. Fine for pre-arranged calls or a teammate playing the supplier. | OpenAI GPT-Live outbound SIP over a Twilio/Telnyx trunk. GA was Nov 4, so it is very new. | OpenAI | Recording consent and AI disclosure. ~$0.34/min carrier. | **NICE / stretch.** Demo flourish only. |
| 8 | 1688 Wangwang | Chinese-only, domestic sellers, often no CE/FCC. | Browser. | Apify (price benchmark) | Heavy anti-bot (inferred). | **Data only.** Price benchmarks plus scraped mobile numbers that may double as WeChat IDs. |
| — | Wechaty / PadLocal | Defunct (last publish 2022). Bans reported right after QR login. | Protocol bot. | — | Clear ToS violation. | **SKIP.** |
| — | WeChat Official Account | 7-15 day verification. Cannot initiate contact. | — | — | — | **SKIP.** |
| — | AliExpress / DHgate | Retail traders, not ODMs. | — | — | — | **SKIP for outreach.** Optional "buy a reference unit" later. |

### The WeChat answer

| Option | Can cold-message? | Ban risk | Hackathon-feasible | Verdict |
|---|---|---|---|---|
| **Personal WeChat via Mobilerun on real hardware** | Yes, via add-friend with a verification note, but low/weekend acceptance. Best when suppliers add us. | Low-moderate (established account, low volume, real device) | Yes, if a teammate has an established account | **PRIMARY** |
| Personal WeChat via Mobilerun **virtual** Android | Yes | **High.** WeChat help centre lists "Using an Android emulator" as a block reason, and Mobilerun calls its Android Phone a "virtual Android device". | Technically | **DO NOT** |
| Personal WeChat via Naive `mobile` tool | Yes | High (fresh device every session) | No. The device ends with the session (max 60 min), so the login is lost. | **DO NOT** |
| **WeCom 微信客服 API** | **No.** The supplier must message first. | Low | Maybe. Unverified-org behaviour is unconfirmed. | **SECONDARY / scale story** |
| Wechaty / PadLocal | Yes | Very high | No (defunct) | **SKIP** |

**Fallback plan, in order.** If WeChat login fails, or we have no established account, or the account gets restricted:
1. Run the entire negotiation in **Alibaba app chat** via Mobilerun.
2. Paste a **WeCom kf link** into Alibaba chat and email ("chat with our sourcing desk on WeChat").
3. Use **AgentMail email**.
4. Use **WhatsApp** for suppliers who list it.

The demo narrative is unchanged: "the agent operates the supplier's channel on a real phone".

---

## 3. Sponsor-by-sponsor

| Tool | Role | How it plugs in | Effort (h) | Priority | Reason |
|---|---|---|---|---|---|
| **Naive** | Runtime, team, approvals, budgets, cron, identity | SDK `@usenaive-sdk/managed-agents`, CLI, `api.vetta.sh/v1` | 8 | **MUST** | Required. HITL, durable sessions and board are core to the judging criteria. |
| **Mobilerun** | Phone hands: WeChat plus Alibaba app | REST/SDK `@mobilerun/sdk` behind our MCP (raw MCP `api.mobilerun.ai/v1/mcp` as quick start) | 6-8 | **MUST** | Only practical WeChat route, and the Mobile track prize. |
| **Apify** | Supplier discovery and enrichment | `apify-client` behind one `find_suppliers` MCP tool | 2.5 | **MUST** | Cheap structured supplier rows (~$0.03 per 50 suppliers). |
| **AgentMail** | Supplier email and paper trail | `agentmail` npm, webhooks to relay | 3 | **MUST** | Threading, Chinese reply extraction, PDF/XLSX quote text. |
| **Neon** | Source of truth plus routing table | `@neondatabase/serverless`, Vercel Marketplace | 2 | **MUST** | Idempotent message store, authority limits, dashboard data. |
| **Vercel** | Dashboard, MCP server, webhook relay | Next.js, route handlers, optional `workflow` | 5 | **MUST** | Public HTTPS ingress (Naive refuses localhost MCP) and the Best Design surface. |
| **OpenAI** | Vision on screenshots and quote images, strict-JSON memo, optional voice | `openai` Responses API from our MCP server; GPT-Live `/v1/live/sessions` | 2-3 (+6 voice) | **MUST** (vision/memo), voice NICE | Naive's proxy rejects images and `response_format`. |
| **OpenRouter** | Mandarin drafting and parsing, fallbacks | OpenAI-compatible `baseURL https://openrouter.ai/api/v1` | 1 | **SHOULD** | Qwen/GLM/DeepSeek are cheap and native in Mandarin. Naive has no BYOK, so spend credits here. |
| **Render** | Always-on WeChat bridge worker (device queue, poll loop); voice WS if built | Background worker $7 | 1.5 | **SHOULD** | Serial one-task-per-device queue needs a long-lived process. Free tier sleeps. |
| **Stripe** | Monetization (Payment Link + Meter); Issuing sandbox "sample card" | `stripe` npm; hosted MCP `mcp.stripe.com` with an agent API key | 1-2.5 | **NICE+** | Pitch and scale story. **Never pays suppliers.** CN payouts are private preview. |
| **HubSpot** | One-way CRM mirror | REST plus **Service Key** (private apps are sunset) | 2-3 | **NICE** | Sponsor checkbox. Duplicates Neon. No WeChat channel type. |
| **Monid** | Extra tools: TikHub WeChat OA lookup, Saperly calls | REST `api.monid.ai/v1/run` from backend | 1 | **NICE** | Check the Naive data catalogue first, since it overlaps heavily. |
| **Luxor** | — | — | 0 | **SKIP** | Sales-led multi-year GPU contracts. Tenki duplicates Naive's Computer. |

### Integration details for the must and should tools

**Naive**
- Setup:
  - `npm i -g @usenaive-sdk/cli`, then `naive auth login`, then **`naive plan subscribe`**. Every non-billing route returns `402 subscription_required` until a plan is active. Standard is $20/mo; the 7-day trial gives $10 and needs a card.
  - `naive keys create`, then `naive models list --search gpt|claude|qwen|glm` and `naive harnesses` to confirm `pi`.
- Agents: `model`, `budget`, `tools.configs`, `mcp_servers:[{type:'url',name:'procops',url:'https://<vercel>/api/mcp'}]`, and `notifications:{email:<founder>, approvals:true, questions:true}`.
- MCP auth must be a **vault `static_bearer`** credential matched by URL. Inline auth headers are rejected and `env_var` returns 501.
- MCP tools default to `ask`, so set each tool to `allow` by name.
- Resume a session: `POST /v1/sessions/{id}/messages` (202).
- Answer an `ask_operator` question: `POST /v1/sessions/{id}/answers {tool_call_id, answers}`.
- Confirm a held tool: `POST /v1/sessions/{id}/tool_confirmations`.
- Pending items: `GET /v1/digest` lists everything waiting.
- Webhooks: `POST /v1/webhooks {url, events:['session.idle']}`, signed with `Vetta-Signature` (HMAC-SHA256 over `{timestamp}.{raw_body}`, 300 s window).
- Deployments: `naive deploy create --cron ... --window loose --on-idle <relay>`.
- Limits: 50 concurrently running sessions. Sessions cannot be deleted.

**Mobilerun**
- Get a key (`dr_sk_…`) through the event QR. Base URL `https://api.mobilerun.ai/v1`.
- `POST /tasks {deviceId, task, llmModel, outputSchema, systemPrompt, maxSteps, executionTimeout≤2700, vision, humanize:true}`, then poll `GET /tasks/{id}/status` and `/trajectory` (per-step screenshots).
- Low-level endpoints: `ui-state` (a11y tree on Android; iOS often returns `DEVICE_TOOL_UNSUPPORTED`), clipboard set, keyboard, files upload, screenshot.
- Webhooks: `task.run.completed`, signed with HMAC-SHA256, 3 attempts.
- Constraints: **one task per device**, with a 30 s contention failure. Stopping a device parks it and keeps the logins.
- **Wrap it in our MCP** (`wechat.send`, `wechat.read_new`, `wechat.add_contact`, `alibaba_app.send`, `alibaba_app.read_inbox`) rather than exposing raw `run_task`. That lets us enforce pacing, serialization, authority limits and logging. The raw Mobilerun MCP is acceptable for the first smoke test.

**Apify**
- `new ApifyClient({token})`, then `client.actor(id).call(input)` and `client.dataset(run.defaultDatasetId).listItems()`. Sync runs cap at 300 s (408 on timeout). Use `maxItems` and `maxTotalChargeUsd`.
- Normalize Alibaba, 1688 and Made-in-China rows into one `Supplier` schema in Neon.
- All the China actors are community-built with 1-155 users. Smoke-test two per marketplace in hour 1.
- Optional: `factline/alibaba-1688-supplier-risk-check` for a UFLPA/BIS/sanctions line in the memo, and `vdrmota/contact-info-scraper` to pull emails and WhatsApp numbers from factory websites.

**AgentMail**
- `new AgentMailClient()`. Create an inbox with `POST /v0/inboxes` (custom domain plus SPF/DKIM/DMARC).
- Webhook events: `message.received`, **`message.received.unauthenticated`** (needs the `label_unauthenticated_read` permission, otherwise mail from suppliers with no SPF is silently missing), and `message.bounced`. Dedupe on `event_id`.
- If the body exceeds 64 KiB it is omitted from the payload; fetch it with Get Message.
- Quotes: `extracted_text` strips Chinese quoted history. Attachment `text_url` covers PDF (text layer), DOCX and XLSX.
- Use the $20 Developer tier or apply for the free Startup month. Free tier adds a footer and caps at 100/day.
- **Ask AgentMail at the booth whether low-volume personalized RFQs count as "cold outreach" before the 18:00 send.**

**Neon**
- Free tier is enough. Add it from the Vercel Marketplace to get `DATABASE_URL`.
- Tables: `suppliers, supplier_contacts, conversations(channel, naive_session_id, board_card_id, next_followup_at), messages(external_id UNIQUE, body_original, body_en), quotes, authority_limits, decision_memos, approvals, audit_events`.
- Agents write only through `procurement-ops` tools. **Do not** give agents raw Neon MCP `run_sql`.

**Vercel**
- Routes:
  - `/api/mcp`: Streamable HTTP MCP server.
  - `/api/webhooks/{agentmail,mobilerun,naive,stripe}`: verify signatures, upsert into Neon, then call Naive.
  - Dashboard pages.
- Hobby limits: 300 s functions and daily-only cron. Use Naive deployments or the Render worker for the overnight cadence.

**OpenAI**
- `client.responses.create` with `input_image` (`detail:'high'|'original'`) and `text.format` `json_schema` `strict`, to extract `{supplier, unit_price, currency, moq, lead_time, certs[], sample_cost}` from screenshots and quote images.
- OpenAI documents weaker accuracy on non-Latin text. **Cross-check numbers with a Chinese VLM** via OpenRouter and flag mismatches.
- Model ids reported by research (`gpt-6.1-sol` for memo/negotiation, `gpt-6-luna` for cheap parsing): pin them only after checking the credited org.

**OpenRouter**
- Used from our MCP server and backend only. Naive does not document OpenRouter or BYOK, so sponsor credits cannot pay for Naive-agent tokens.
- `provider:{data_collection:'deny'}` and a `models:[...]` fallback array.
- Mandarin drafting: `qwen/qwen3.8-max-prime`. Cheap parsing and OCR cross-check: `qwen/qwen3.8-flash` or `z-ai/glm-5.3-flash`. These ids come from today's `/api/v1/models` per research.

**Render**
- One background worker named `wechat-bridge`. It holds a per-device FIFO queue, so only one Mobilerun task runs per device, and polls `wechat.read_new` every 15-30 min during Shenzhen daytime.
- It writes to Neon and calls Naive `sessions.send`.
- Use the $7 Starter instance. The free tier sleeps after 15 min.

---

## 4. Architecture

### Agent roster (Naive Team, all `pi` harness)

| Agent | Model | Key tools | Permissions |
|---|---|---|---|
| **Head of Procurement** (coordinator, owns board) | strong catalogue model, immediate window | `board_read/write`, `send_to_agent`, `ask_operator`, `procops.memo_compose` (OpenAI strict JSON), `procops.ledger_read`, `publish_file` | `ask_operator` on. `notifications.email` set to the founder. |
| **Scout** (reads only public data) | cheap model | `web_search/fetch`, `data_run` (trade/compliance), `procops.find_suppliers` (Apify), `procops.risk_check`, `board_write` (one card per supplier) | All `allow`. **Never reads mail or messages**, so it is never flagged for "reading people's data". |
| **Envoy** (one long-lived session per supplier: outreach, negotiation, follow-up) | strong model; Mandarin drafting via `procops.draft_zh` (OpenRouter Qwen) | `procops.wechat_send/add_contact`, `procops.alibaba_send`, `procops.email_send` (AgentMail), `procops.record_quote`, `procops.propose_offer` (limit-checked) | First contact per supplier: `ask` on the first demo run only, then `allow`. Anything binding stays `ask` or is unavailable. |
| *(optional)* **Closer** | — | post-approval sample/PI/shipping messages, `procops.stripe_payment_link`, HubSpot mirror | Payment tools are always `ask`. Agents never pay. |

**Fallback if Teams is not enabled.** `skill.md` still lists multiagent teams as "coming soon" while the docs and OpenAPI show them shipped, so verify at kickoff. If they are missing, run three standalone agents and coordinate them through Neon plus our relay. The pitch is unchanged.

### Data flow

```
                ┌──────────── FOUNDER (dashboard / email deep-link / SMS) ────────────┐
                │                                         ▲ decision memo + "Proceed?"  │
                ▼ POST /answers                          │ (ask_operator, awaiting_answer)
┌────────────────────────── NAIVE (pi harness, Team + Board) ──────────────────────────┐
│  Head of Procurement ──send_to_agent / board cards──► Scout      Envoy[supplier_i]   │
│        ▲  digest when cards done/blocked                 │             │  ▲          │
└────────┼─────────────────────────────────────────────────┼─────────────┼──┼──────────┘
         │ session.idle webhook                    MCP calls│      MCP calls│  │ POST /sessions/{id}/messages
         ▼                                                  ▼             ▼  │ (supplier reply as input)
┌──────────────────────── VERCEL: procurement-ops MCP + relay + dashboard ───────────────┐
│ find_suppliers ─► Apify      wechat_* / alibaba_* ─► queue ─► RENDER wechat-bridge ─┐  │
│ email_send ─► AgentMail      draft_zh ─► OpenRouter   extract ─► OpenAI vision       │  │
│ propose_offer ─► LIMIT CHECK (authority_limits)        all writes ─► NEON            │  │
└───────────▲────────────────────────▲──────────────────────────────────────────────────┼──┘
            │ AgentMail webhook       │ Mobilerun task.run.completed                     ▼
       Supplier email            Mobilerun devices: [real phone: WeChat] [cloud: Alibaba app]
                                              ▲                    ▲
                                       Shenzhen supplier reps (Sunday daytime CN)
```

**Pipeline:** Discovery (Scout to Apify, scored into Neon, board cards) → Outreach (Envoy: Alibaba chat plus RFQ, email, WeChat) → Reply ingestion (bridge or AgentMail webhook to relay to Neon to `sessions.send`) → Analysis (Envoy records the quote; the coordinator's digest compares quotes) → Founder approval (`ask_operator`) → Follow-up (the resumed coordinator delegates to Envoy, which sends a "proceed" message requesting the sample PI, DHL schedule and Trade Assurance link).

### Where state lives
- **Neon:** authoritative. Messages are deduped by `external_id`. Quotes, limits, approvals, and the routing `(channel, handle) → {naive_session_id, board_card_id}`.
- **Naive session:** the conversation context of each per-supplier negotiation. It is resumable, and parked sessions cost only storage.
- **Naive board:** pipeline visibility and wake mechanism. **Caution:** a card has a limited number of re-wakes (re-opening spends one of three), so use `sessions.send` for continuity, not card reopen.
- **Mobilerun device:** ground truth for the WeChat history. Trajectory screenshots serve as evidence.
- **AgentMail:** email threads.

### How inbound replies wake the right session
Naive has **no inbound webhook that resumes a session**. Naive's own inbound email and SMS start a **new** session each time and are rate-guarded (5/hr per sender, 10 thread turns per day). Therefore:
1. **Email:** AgentMail webhook → relay → look up `thread_id` → `POST /v1/sessions/{id}/messages` with the fenced supplier text and extracted attachment text.
2. **WeChat / Alibaba app:** the Render bridge polls `read_new`, writes to Neon, looks up the contact remark, and calls `sessions.send` on that supplier's Envoy session.
3. **Founder:** the dashboard button or SMS relay → `POST /answers`, or `/tool_confirmations` for `ask` tools.

### Human approval loop
- Envoy's `propose_offer` and send tools validate against `authority_limits` **server-side**. Any offer outside limits is rejected with "needs founder".
- When quotes are in, the coordinator writes a `DecisionMemo` (structured output, ranked suppliers, landed cost, risks, trajectory screenshots as evidence). It then calls **`ask_operator`** with `decision: choice[proceed, counter, reject]` and `note: text (optional)`.
- Naive emails the founder a deep link. Our relay also catches the `session.idle` with `stop_reason=awaiting_answer` and texts or Slacks the founder. The dashboard lists items from `GET /v1/digest`.
- A "proceed" answer resumes the exact coordinator session, which delegates the follow-up to Envoy.

**Autonomy trap. Test this in hour 1.** Once a chat has "read people's data", every send, `board_write`, `mobile` call and MCP tool **asks each time, even at `allow`**. It is undocumented whether relay-injected messages trigger this flag.
- If they do, fall back to **intent-out mode**: Envoy ends each turn with a structured output `{next_message, channel, contact}`, and the relay executes the send after receiving the `session.idle` webhook carrying `structured_output`.
- The limit checks still run in our server, and no tool call has to be approved.

---

## 5. WeChat route deep plan

1. **Account (decide in the first 30 min).** Use an **established** account a teammate owns: months old, real non-VoIP number, has friends. A new account made today needs friend-QR verification, faces roughly 5-10 adds/day limits and triggers risk-control prompts. Don't. Accept that moving the login to the demo phone **logs out the teammate's own phone**. Never use anyone's critical personal account if they can't risk it.
2. **Device, safest first:**
   - (a) A teammate's spare **physical Android** with the Mobilerun Portal APK (accessibility service plus display-over-other-apps). It shows up as a "Personal Phone". Keep it on power and stable Wi-Fi for 20 hours, with no VPN. Ask Mobilerun whether the hackathon covers this slot.
   - (b) A **Mobilerun physical iPhone**. Claim it at kickoff, first come first served. Expect `vision=true` because there is no a11y tree, and ask who signs into the App Store and where the device's IP is (a location jump can trigger WeChat risk checks).
   - (c) Never a virtual Android.
   - Put the **Alibaba app on a separate device** (a Mobilerun cloud Android is fine), because one device runs one task at a time.
3. **Install and login.** Android: Play Store (needs a Google account) or the official APK upload; the docs only document APK upload. Log in with phone plus SMS. Have a friend ready for a security-assist scan. Log in once and never log out.
4. **Contact naming convention.** Set every supplier's remark to `S012 Shenzhen-XYZ` so the agent opens chats by searching the remark deterministically. Store the remark in `supplier_contacts.handle`.
5. **Adding suppliers.**
   - Prefer that they add us: put our WeChat ID or QR in Alibaba chat and email.
   - Otherwise search their ID or phone number (a 1688 scraped mobile number often works, inferred) and attach a Chinese verification note: "美国跌倒检测设备公司采购，想咨询毫米波雷达模组报价".
   - Cap at **≤5 new adds today**. **Pre-seed 2-3 contacts now**: Chinese-speaking friends, a sourcing agent, or a supplier who has already replied. Label them honestly in the demo.
6. **Send loop.** `wechat.send(remark, text)` goes to the bridge queue, which runs a Mobilerun task with a strict system prompt:
   - Open search, type the remark, open the chat.
   - **Paste from the clipboard** (set via the API, because Chinese typing through the keyboard endpoint is undocumented; test it).
   - Tap Send, verify the last bubble equals the text, and return `{sent, last_bubble, ts}`.
   - Use `humanize:true` and **≥45-60 s between sends**, which is more conservative than the 5-10 s some sources suggest. Cap at about 30 messages per day.
   - Expect roughly 30-90 s per send (estimate).
7. **Read loop.** Every 15-30 min while Shenzhen is awake (≈17:00-02:00 SF, sparser overnight), run a task: "Chats tab → for each chat with an unread badge return `{remark, messages[{text, ts, type}]}`" with an `outputSchema`, and cap `maxSteps` so the sweep fits within 45 min.
   - On Android, also pull `ui-state` text as a cross-check.
   - Images and files: screenshot plus the files API.
   - Voice notes: long-press, then 转文字 (Convert to Text), untested.
   - Hash `remark+ts+text` into `external_id` and dedupe in Neon.
8. **Screenshot → vision.** Keep trajectory screenshots. For any message containing numbers (price, MOQ, lead time), run OpenAI vision (`detail:'high'`, cropped chat region, strict schema) **and** a Qwen/GLM VLM. If the extractions disagree, mark the quote `needs_review` and ask the supplier to confirm in text ("请确认：单价¥X，起订量Y？").
9. **Anti-ban practices.**
   - One account per device. Stable IP, no VPN hopping.
   - Individually composed messages, never templated blasts.
   - No mass adds. Human approval of the first message to each new supplier (also good optics).
   - Stop immediately on any WeChat security prompt and switch to the fallbacks.
10. **Fallback:** Alibaba app chat via Mobilerun, then the WeCom kf link, then AgentMail email, then WhatsApp. Also record a clean end-to-end run on video by Sunday morning.

---

## 6. Build order (12.5 h left: Sat 22:30 → Sun 11:00 PST)

Shenzhen is Sunday afternoon right now and goes quiet around 06:00 PST. **Every hour of delay before the first send cuts real-reply odds.** Order below is strict: outreach first, agents second, dashboard third.

| Time (PST) | Shenzhen | Box | Notes |
|---|---|---|---|
| **22:30-23:30** | Sun 14:30 | **Unblock + post the Alibaba RFQ by hand (10 min).** Naive plan/keys, `naive models list`, `naive harnesses`. Mobilerun key + one device; install and log into the Alibaba app and WeChat (established account, real/BYO phone). Apify smoke test → shortlist of 15 suppliers. AgentMail inbox + Neon + Vercel accounts. | Manual RFQ is fine: the agent handles the replies, and the memo says so. |
| **23:30-00:30** | Sun 15:30 | **Wave 1 out by 00:30.** AgentMail emails to ~10 suppliers (pure API, fastest). Alibaba chat inquiries to ~10 via one Mobilerun `run_task` ("open each supplier, send this inquiry, ask for their WeChat"). WeChat adds/messages to 2-3 pre-seeded contacts. | Founder approves the first-contact text once; everything after is agent-sent. |
| 00:30-03:00 | Sun 16:30 | `procurement-ops` MCP on Vercel: `find_suppliers`, `email_send`, `wechat_send/read_new`, `alibaba_send/read_inbox`, `record_quote`, `propose_offer` (limit check in code). Neon schema. Naive agents (Scout, Envoy, Head of Procurement) with `ask_operator` memo flow. Relay: AgentMail webhook → `sessions.send`; dashboard button → `/answers`. | Test the "read people's data" flag here; switch to intent-out mode if it trips. |
| 03:00-05:00 | Sun 19:00 | Read loop (Mobilerun sweep every 20-30 min, write to Neon, wake the Envoy session). Dashboard v1: pipeline Kanban, bilingual threads, quote table, Approve button. | Replies are most likely in this window. |
| 05:00-07:00 | Sun 21:00 | Let it run. Watch only, log incidents. Fix breakages. | Last real replies arrive ~06:00 PST. |
| 07:00-09:00 | Sun 23:00 | Head of Procurement writes the decision memo from whatever came in → `ask_operator` → founder answers `proceed` → Envoy sends the sample/PI request on WeChat and mirrors to email. **Record the backup video.** | If no real quote arrived, use the pre-seeded contact's quote and label it. |
| 09:00-11:00 | Mon 01:00 | Pitch deck + metrics (suppliers found/contacted/replied, agent-hours unattended, human touches = 1-2, cost per supplier). Dashboard polish. Pre-open Studio board and Neon snapshot for the demo. | Hacking stops 11:00. |

**Cut order if behind** (cut from the top): Voice/GPT-Live → HubSpot → Stripe → Monid → WeCom → Made-in-China outreach → Naive browser path (keep Mobilerun) → Teams/board (standalone agents + Neon) → dashboard polish (a plain table beats a broken Kanban).

**Never cut:** wave 1 by 00:30, the `ask_operator` approval loop, the relay that wakes sessions, the recorded fallback video.

**If you are solo:** do 22:30-00:30 exactly as above, then build only the Envoy agent + relay + memo flow (skip Scout as an agent; the Apify shortlist can be a script), and make the dashboard a single page.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **WeChat account restricted or banned** | Real hardware only, established account, ≤5 adds, slow pacing, no VPN, human approval of first contact. Stop on any prompt. The fallback chain is ready. Never risk an account its owner can't lose. |
| **Alibaba buyer-account suspension** (ToS on automated access) | Low volume, one real account, mobile app instead of web scraping. Discovery goes through Apify (public data), not the logged-in account. |
| **AgentMail "no cold outreach" ToS** | 10-20 personalized RFQs to addresses published for inquiries, opt-out line, AI disclosure. Get booth sign-off first. Fallback: Naive Identity email (but that starts a new session per inbound). |
| **QQ/163 spam placement** | Plain text, no links, custom domain with DMARC. Seed-test to a teammate's QQ mailbox. Treat email as the record, not the hook. |
| **Naive "read people's data" flag kills autonomy** | Test in hour 1. Keep Scout separate. Inject replies via the relay. Use intent-out mode (send executed by the relay on `session.idle`) if flagged. |
| **Over-asking hurts the "runs without humans" score** | `allow` everything except first contact (demo run only) and binding or payment actions. Show an approval count of about 1-2 in the pitch. |
| **Teams not enabled for our org** | Standalone agents plus Neon coordination. |
| **Mobilerun brittleness** (one task per device, 45-min cap, iOS has no a11y tree, latency) | Serial queue on Render, short tasks, clipboard paste, verify-after-send, two devices, recorded video. |
| **Weekend: few real replies** | Post the RFQ by noon, pre-seed contacts, label friendly contacts honestly, show RFQ bids and auto-replies as real signal. |
| **Prompt injection from supplier messages** | Fence inbound text as untrusted (Naive does this for inbound mail; we do it in the relay). Limits are enforced server-side. Payment tools stay `ask` and are never callable from Envoy. |
| **Payments** | **Agents never commit money.** Sample and PO payments go to the founder as a Trade Assurance link (card, T/T or PayPal; protection applies only to on-platform payment). Stripe CN payouts are private preview. Issuing is sandbox only. |
| **Call recording / AI disclosure** | If voice is built: open every call in Mandarin with "AI procurement assistant, this call is recorded". California requires all-party consent. FCC treats AI voices as "artificial" under TCPA. China's AI-labeling rules push toward disclosure. China-law points are secondary-source. Prefer calls to a teammate. |
| **Fraud / sanctions** | Sanctions/UFLPA screen before outreach (factline actor or Naive `compliance` data). Red flag: "pay our private or offshore account". Recommend Trade Assurance. |
| **Demo-day failure** | Recorded run, screenshots from Mobilerun trajectories, a pre-loaded Neon snapshot, and a pre-opened Studio board. |

---

## 8. Prize-track angles

**Best Mobile Automation (Mobilerun)**
- Show two real phones in parallel, embedded live in our dashboard (the embed-device-stream guide): the Alibaba app inbox plus WeChat on real hardware.
- Show the unattended loop: send, overnight poll, `outputSchema` extraction, quote, memo, "proceed" sent on WeChat.
- Show trajectory screenshots as audit evidence in the memo, plus cost per supplier (steps × ~$0.005).
- Emphasize what judges stated they want: a working workflow, not an agent explaining what it would do.

**Overall (autonomy)**
- A timeline of "hours without humans" overnight, with the number of human touches (1 approval).
- Sessions parked for hours at zero compute and woken by real Shenzhen replies.
- Hard authority limits enforced in code. Budget caps visible.
- Answer to "Why not Alibaba Accio?": multi-channel (WeChat, email, voice), multi-marketplace, founder memo plus proceed loop, Naive-native, and it generalizes to sourcing humans (Apify Google Maps or LinkedIn actors feed the same pipeline).

**Best Design**
- The founder cockpit: a Kanban of suppliers moving from found to ordered.
- Side-by-side bilingual threads (中文 / EN).
- A quote comparison with landed-cost bars, and a one-tap Approve that calls `/answers`.
- A live phone stream panel, and a morning "while you slept" digest.

**Most likely to scale**
- WeCom 微信客服 as the compliant API path (if the test passes).
- Stripe Payment Link plus a Billing Meter per decision memo.
- Trade Assurance first, then direct Stripe payouts to an HK account after trust is established.
- The same department sources tutors and creators.

---

## 9. Booth questions

**Naive**
- Are multiagent Teams and the board enabled for hackathon orgs (`skill.md` says "coming soon")?
- Credits: amount and redemption code, and does a plan still need a card?
- Do relay-injected `sessions.send` messages or inbound-email wakes set the "read people's data" flag?
- Are OpenAI, Claude and Qwen ids in our catalogue? Is the inference network OpenRouter, and is BYOK possible?
- Is cron evaluated in UTC or the company timezone?
- Is the built-in `mobile` tool backed by Mobilerun? What does "link your Mobilerun key to Naive" actually do?

**Mobilerun**
- Do the 72 hours include a persistent Android Phone and/or a Connect-your-own-phone slot? Can we hold one iPhone all weekend?
- Has anyone run WeChat on your fleet? Does the virtual Android trip emulator detection? Where are the iPhones' IPs located?
- Does Chinese text input work via the keyboard endpoint? Play Store vs APK for WeChat, Alibaba and 1688?
- Real per-step latency? What are the prize criteria?

**AgentMail**
- Is a personalized low-volume supplier RFQ acceptable under the cold-outreach clause?
- What are the hackathon credits? Any known QQ/163 deliverability data?

**Apify**
- Hackathon credits? Which China-marketplace actors do you trust? MCP tool-name format for `?tools=` actors?

**Monid**
- Credits? Does Saperly reach +86 numbers with Mandarin voices? Does the Naive vault `mcp_oauth` work with your MCP?

**OpenAI**
- Credit amount, and is the credited org on a paid tier (gpt-live-1 isn't on Free)? Mandarin quality and stability of outbound SIP since Nov 4?

**OpenRouter**
- Credit amount? Recommended providers for Qwen/GLM tool-calling reliability?

**Stripe**
- Does Issuing sandbox work before Issuing approval? Agent API keys for the hosted MCP?

**Vercel / Render / Neon**
- Event credits? Any prize criteria requiring deployment on their platform?

**HubSpot**
- Can Service Keys be created inside a developer test account (Enterprise trial)?

**Luxor**
- Any Tenki or GPU credits? (Only out of curiosity; we are skipping Luxor.)

---

## 10. Sources

**Naive**
- https://usenaive.ai/docs/concepts/sessions.md
- https://usenaive.ai/docs/concepts/session-operations.md
- https://usenaive.ai/docs/api/sessions.md
- https://usenaive.ai/docs/capabilities/tools.md
- https://usenaive.ai/docs/api/agents.md
- https://usenaive.ai/docs/api/digest.md
- https://usenaive.ai/docs/team/overview.md
- https://usenaive.ai/docs/team/board.md
- https://usenaive.ai/docs/identity/inbound.md
- https://usenaive.ai/docs/identity/email.md
- https://usenaive.ai/docs/identity/phone.md
- https://usenaive.ai/docs/identity/vault.md
- https://usenaive.ai/docs/computer/browser.md
- https://usenaive.ai/docs/computer/mobile.md
- https://usenaive.ai/docs/capabilities/deployments.md
- https://usenaive.ai/docs/capabilities/webhooks.md
- https://usenaive.ai/docs/concepts/model-router.md
- https://usenaive.ai/docs/api/proxy.md
- https://usenaive.ai/docs/capabilities/data.md
- https://usenaive.ai/docs/platform/pricing.md
- https://usenaive.ai/skill.md
- https://api.vetta.sh/v1/openapi.json

**Mobilerun**
- https://docs.mobilerun.ai/cloud/quickstart.md
- https://docs.mobilerun.ai/api-reference/tasks/run-task.md
- https://docs.mobilerun.ai/tasks.md
- https://docs.mobilerun.ai/devices.md
- https://docs.mobilerun.ai/device-types.md
- https://docs.mobilerun.ai/mcp-server.md
- https://docs.mobilerun.ai/webhooks.md
- https://docs.mobilerun.ai/guides/connect-android.md
- https://docs.mobilerun.ai/guides/connect-iphone.md
- https://mobilerun.ai/apps/alibaba
- https://mobilerun.ai/blog/posts/autonomous-company-hackathon-naive-mobilerun

**WeChat / WeCom**
- https://help.wechat.com/cgi-bin/micromsg-bin/oshelpcenter?opcode=2&id=120813euejvf150504mfan7b&t=help_center%2Fw_topic_detail
- https://developer.work.weixin.qq.com/document/path/94677
- https://developer.work.weixin.qq.com/document/path/94670
- https://developer.work.weixin.qq.com/document/path/92135
- https://yage.ai/share/wechat-uia-platform-feasibility-survey-en-20260327.html
- https://github.com/wechaty/puppet-supports/issues/626
- https://chinaneighbor.com/guide/essentials/wechat-for-foreigners-guide-2026/

**Alibaba / marketplaces**
- https://smartbuy.alibaba.com/buyingguides/how-to-contact-alibaba
- https://activity.alibaba.com/ggs/your_step_by_step_guide_to_using_our_request_for_quotation_tool.html
- https://openapi.alibaba.com/doc/doc.htm
- https://terms.alicdn.com/legal-agreement/terms/common_platform_service/20231122170213233/20231122170213233.html
- https://buyer.alibaba.com/page/tradeassurance/buyer/story.html
- https://www.digitalcommerce360.com/2026/07/24/alibaba-accio-work-agentic-ai-b2b-sourcing/

**Apify / Monid**
- https://docs.apify.com/platform/integrations/mcp
- https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post
- https://apify.com/rel8ble/alibaba-supplier-search-scraper
- https://apify.com/silentflow/alibaba-scraper
- https://apify.com/lentic_clockss/1688-global-scraper
- https://apify.com/scrapesage/made-in-china-scraper
- https://apify.com/factline/alibaba-1688-supplier-risk-check
- https://monid.ai/docs/api/overview
- https://www.notis.ai/blog/monid-review/

**AgentMail / HubSpot**
- https://docs.agentmail.to/webhooks-overview.md
- https://docs.agentmail.to/knowledge-base/cold-outreach.md
- https://docs.agentmail.to/reply-extraction.md
- https://docs.agentmail.to/knowledge-base/inbound-emails-missing.md
- https://www.agentmail.to/pricing
- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys

**Models / voice**
- https://developers.openai.com/api/docs/guides/voice-sip
- https://developers.openai.com/api/docs/models/gpt-live-1
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/pricing
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/api/v1/models
- https://assets.cdn.prod.twilio.com/pricing-csv/OutboundVoicePricing.csv

**Infra / payments**
- https://neon.com/pricing
- https://github.com/neondatabase/mcp-server-neon
- https://vercel.com/kb/guide/background-workers-on-vercel
- https://vercel.com/docs/functions/limitations
- https://render.com/docs/free
- https://docs.stripe.com/mcp
- https://docs.stripe.com/issuing/agents
- https://docs.stripe.com/global-payouts/recipient-countries
- https://luxor.tech/ai/compute

**Known unverified or conflicting items (resolve on site):**
- Teams availability: `skill.md` says "coming soon", while the docs and OpenAPI show it shipped.
- Whether Naive's `mobile` tool is powered by Mobilerun.
- WeChat behaviour on Mobilerun devices (no public reports either way).
- WeCom unverified-org sending.
- AgentMail ToS stance on supplier RFQs.
- Hackathon credit amounts. Only the third-party "$1k+" claim exists.
- New OpenAI and OpenRouter model ids, which exist only in research snapshots. Pin them after checking.