# Alibaba conversation history

Read-only exports of the buyer account's Alibaba.com Messenger threads and RFQ quotations, captured by the phone agent
(Mobilerun cloud Android running the official Alibaba.com app) with `scripts/26-alibaba-history.ts`.

Each `<timestamp>/` folder contains:
- `frames/NNN.png` — every screenshot the phone agent saw, in order (the visual record of each thread being scrolled)
- `transcript.md` — human-readable thread-by-thread transcript plus the RFQ status and quotes
- `transcript.json` — the same data as structured JSON (`threads[]`, `rfq`)

The export never types or sends anything. Messages it finds are also mirrored into the pipeline database so
the dashboard reflects what the phone saw.
