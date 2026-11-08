import OpenAI from "openai";

// Called directly (not through Naive's proxy, which rejects image inputs and strict JSON).
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: { "HTTP-Referer": process.env.PUBLIC_BASE_URL || "http://localhost", "X-Title": "procurement-dept" },
});

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-5.4-mini";
const ZH_MODEL = process.env.OPENROUTER_ZH_MODEL || "qwen/qwen3.5-plus";

export type QuoteFields = {
  unit_price: number | null; currency: string | null; moq: number | null; lead_time_days: number | null;
  certs: string[]; sample_cost: number | null; sample_lead_days: number | null; payment_terms: string | null;
  incoterm: string | null; confidence: "high" | "medium" | "low"; notes: string;
};

const QUOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    unit_price: { type: ["number", "null"] },
    currency: { type: ["string", "null"], description: "USD or CNY/RMB" },
    moq: { type: ["integer", "null"] },
    lead_time_days: { type: ["integer", "null"] },
    certs: { type: "array", items: { type: "string" } },
    sample_cost: { type: ["number", "null"] },
    sample_lead_days: { type: ["integer", "null"] },
    payment_terms: { type: ["string", "null"] },
    incoterm: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
  required: ["unit_price", "currency", "moq", "lead_time_days", "certs", "sample_cost", "sample_lead_days", "payment_terms", "incoterm", "confidence", "notes"],
} as const;

const EXTRACT_PROMPT =
  "You read supplier messages (Chinese or English) for a buyer of fall-detection sensor modules. Extract commercial terms exactly as stated. " +
  "Use null when not stated. Prices like ¥/RMB/元 are CNY; $/USD are USD. MOQ = 起订量, lead time = 交期/交货期, sample = 样品/打样. " +
  "confidence=low if numbers are ambiguous or partially visible.";

/** Extract quote fields from text (email body, chat transcript). */
export async function extractQuoteFromText(text: string): Promise<QuoteFields> {
  const r = await openai.responses.create({
    model: VISION_MODEL,
    input: [{ role: "user", content: [{ type: "input_text", text: `${EXTRACT_PROMPT}\n\nMESSAGE:\n${text}` }] }],
    text: { format: { type: "json_schema", name: "quote", schema: QUOTE_SCHEMA as any, strict: true } },
  });
  return JSON.parse(r.output_text) as QuoteFields;
}

/** Extract quote fields from a chat screenshot (WeChat / Alibaba app). `image` = data URL or https URL. */
export async function extractQuoteFromImage(image: string, hint = ""): Promise<QuoteFields> {
  const r = await openai.responses.create({
    model: VISION_MODEL,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: `${EXTRACT_PROMPT}\nOnly read the supplier's (left-side / incoming) bubbles. ${hint}` },
        { type: "input_image", image_url: image, detail: "high" } as any,
      ],
    }],
    text: { format: { type: "json_schema", name: "quote", schema: QUOTE_SCHEMA as any, strict: true } },
  });
  return JSON.parse(r.output_text) as QuoteFields;
}

/** Transcribe/translate a chat screenshot into plain text lines (for the thread view). */
export async function readChatScreenshot(image: string): Promise<{ lines: { from: "supplier" | "us"; text: string; time?: string }[] }> {
  const r = await openai.responses.create({
    model: VISION_MODEL,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "Transcribe this chat screenshot. Return each bubble in order. 'supplier' = incoming (left), 'us' = outgoing (right). Keep original language." },
        { type: "input_image", image_url: image, detail: "high" } as any,
      ],
    }],
    text: {
      format: {
        type: "json_schema", name: "chat", strict: true,
        schema: {
          type: "object", additionalProperties: false,
          properties: { lines: { type: "array", items: { type: "object", additionalProperties: false,
            properties: { from: { type: "string", enum: ["supplier", "us"] }, text: { type: "string" }, time: { type: ["string", "null"] } },
            required: ["from", "text", "time"] } } },
          required: ["lines"],
        },
      },
    },
  });
  return JSON.parse(r.output_text);
}

/** Idiomatic B2B Mandarin drafting via a Chinese model on OpenRouter. */
export async function draftZh(intent: string, context: string): Promise<{ text_zh: string; text_en: string }> {
  const r = await openrouter.chat.completions.create({
    model: ZH_MODEL,
    messages: [
      { role: "system", content: "你是一家美国硬件初创公司的采购专员。用自然、礼貌、简洁的中文商务口吻写微信/阿里旺旺消息（不要太正式，像真人采购）。不要承诺付款或下单；涉及付款一律说需要创始人确认并走阿里巴巴信保。只输出JSON: {\"text_zh\": string, \"text_en\": string}（text_en 是中文的忠实英译）。" },
      { role: "user", content: `意图: ${intent}\n\n上下文:\n${context}` },
    ],
    response_format: { type: "json_object" } as any,
    temperature: 0.4,
  });
  const raw = r.choices[0]?.message?.content ?? "{}";
  try {
    const j = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
    return { text_zh: String(j.text_zh ?? ""), text_en: String(j.text_en ?? "") };
  } catch {
    return { text_zh: raw, text_en: "" };
  }
}

export async function translateToEn(text: string): Promise<string> {
  if (!/[一-鿿]/.test(text)) return text;
  const r = await openrouter.chat.completions.create({
    model: ZH_MODEL,
    messages: [{ role: "system", content: "Translate the user's Chinese business message to natural English. Output only the translation." }, { role: "user", content: text }],
    temperature: 0,
  });
  return r.choices[0]?.message?.content?.trim() || text;
}

/** Decision memo: ranked suppliers + markdown, strict JSON. */
export async function memoCompose(input: { company: string; target_qty: number; limits: Record<string, unknown>; suppliers: unknown[] }) {
  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      markdown: { type: "string" },
      recommended_supplier_id: { type: ["integer", "null"] },
      ranked: { type: "array", items: { type: "object", additionalProperties: false,
        properties: { supplier_id: { type: "integer" }, rank: { type: "integer" }, landed_cost_usd: { type: ["number", "null"] }, why: { type: "string" }, risks: { type: "array", items: { type: "string" } } },
        required: ["supplier_id", "rank", "landed_cost_usd", "why", "risks"] } },
      proposed_next_step: { type: "string" },
    },
    required: ["markdown", "recommended_supplier_id", "ranked", "proposed_next_step"],
  };
  const r = await openai.responses.create({
    model: process.env.OPENAI_MEMO_MODEL || VISION_MODEL,
    input: [{ role: "user", content: [{ type: "input_text", text:
      `You are the Head of Procurement at ${input.company}. Write a founder decision memo (markdown, ≤350 words) comparing suppliers for ${input.target_qty} fall-detection sensor modules. ` +
      `Rank by landed cost, lead time, certifications (CE/FCC), supplier credibility, and risk. Authority limits: ${JSON.stringify(input.limits)}. ` +
      `State clearly what you recommend and what you need the founder to decide (proceed / counter / reject). Never commit money.\n\nDATA:\n${JSON.stringify(input.suppliers, null, 1)}` }] }],
    text: { format: { type: "json_schema", name: "memo", schema: schema as any, strict: true } },
  });
  return JSON.parse(r.output_text) as { markdown: string; recommended_supplier_id: number | null; ranked: any[]; proposed_next_step: string };
}
