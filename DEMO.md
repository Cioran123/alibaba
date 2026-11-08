# Demo script (3 minutes) — "the department that talks to the outside world"

**Setup before going on stage:** worker running (`caffeinate -i npm run script scripts/32-poll-inboxes.ts`), ngrok tunnel up,
`/ops?token=…` open in a tab, Mobilerun console open on both phones, `GET /api/pipeline` stats in the frontend.

1. **The problem (20 s).** "An autonomous company still has to deal with people outside its systems. Our demo company
   sells a fall-detection device for seniors and needs a Chinese hardware supplier. Judges: watch how little we touched."
2. **Discovery (20 s).** Pipeline view: 27 suppliers found on Alibaba by the Scout (Apify), scored, each with a contact route.
3. **Outreach on a real phone (40 s).** Show the Mobilerun phone: the agent opened Alibaba, pasted the inquiry, hit send —
   `public/evidence/<taskId>/last.png` shows "inquiry sent" (timestamps: Saturday night SF = Sunday afternoon Shenzhen).
   Stat: N inquiries sent by the agent, 0 by humans.
4. **Overnight autonomy (40 s).** Replies came in while we slept: the worker swept the inboxes every 20 min, each reply
   woke that supplier's Envoy session on Naïve, which recorded the quote (`record_quote`), checked its authority
   (`propose_offer` — limits enforced in code), drafted Chinese (`draft_zh`) and answered. Show a thread with the
   bilingual log. Stat: hours unattended, messages exchanged, human touches so far = 0.
5. **The one human decision (40 s).** The Head agent wrote the decision memo and asked the founder via `ask_operator`.
   Open `/ops`: memo + Proceed / Counter / Reject. Click **Proceed**. The session resumes and the follow-up
   (samples, PI, Trade Assurance link) goes to the supplier on their channel — watch the phone send it live.
6. **Why this scales (20 s).** Same department sources tutors, teachers, LinkedIn creators (teammate's track).
   Clients onboard their own channel identity (their phone as a Mobilerun Personal Phone, or WeCom). Agents never pay;
   money moves only through Alibaba Trade Assurance by the founder.

**Anticipated question — "Alibaba has Accio, how is this different?"** Multi-channel (Alibaba, email, WeChat on a real
phone), multi-marketplace, hard authority envelope enforced outside the model, founder memo + proceed loop, and the same
loop works for sourcing people, not just parts.

## Metrics (run before the demo)
```sql
select count(*) filter (where stage <> 'found') contacted,
       count(*) filter (where stage in ('replied','negotiating','recommended','approved')) replied
from suppliers;
select count(*) agent_messages from messages where sent_by = 'agent';
select count(*) quotes from quotes;
select count(*) human_decisions from approvals where decision is not null;
select min(ts), max(ts) from messages;  -- unattended window
```
Or just `GET /api/pipeline` → `stats`.

## If something breaks on stage
- Phone busy / Mobilerun slow: show the recorded evidence frames and the `device_jobs` table.
- Naïve session stuck: `/ops` shows the parked question; `npm run script scripts/33-memo.ts` re-runs the memo.
- No real replies: the pre-seeded WeChat contact thread (labelled honestly) demonstrates the loop.
