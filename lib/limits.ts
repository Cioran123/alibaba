import { limits } from "./db";

export type Offer = {
  unit_price_usd?: number;
  moq?: number;
  sample_spend_usd?: number;
  incoterm?: string;
  payment_terms?: string;
};

/**
 * Hard authority envelope, enforced in code — the agent cannot talk its way past it.
 * Returns ok=false with a reason the agent should relay as "I need to confirm with my founder".
 */
export async function checkOffer(o: Offer): Promise<{ ok: boolean; reason?: string }> {
  const L = await limits();
  if (o.unit_price_usd != null && o.unit_price_usd > Number(L.max_unit_price_usd))
    return { ok: false, reason: `unit price $${o.unit_price_usd} exceeds authority ($${L.max_unit_price_usd}); needs founder` };
  if (o.moq != null && o.moq > Number(L.max_moq))
    return { ok: false, reason: `MOQ ${o.moq} exceeds authority (${L.max_moq}); needs founder` };
  if (o.sample_spend_usd != null && o.sample_spend_usd > Number(L.max_sample_spend_usd))
    return { ok: false, reason: `sample spend $${o.sample_spend_usd} exceeds authority ($${L.max_sample_spend_usd}); needs founder` };
  if (o.incoterm && !(L.allowed_incoterms as string[]).includes(o.incoterm.toUpperCase()))
    return { ok: false, reason: `incoterm ${o.incoterm} not allowed (${(L.allowed_incoterms as string[]).join(", ")})` };
  if (o.payment_terms) {
    const bad = (L.never as string[]).find((n) => o.payment_terms!.toLowerCase().includes(n));
    if (bad) return { ok: false, reason: `payment terms mention "${bad}" — never allowed; founder pays only via Trade Assurance` };
  }
  return { ok: true };
}
