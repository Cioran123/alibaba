// Supplier discovery: Apify actors → suppliers/supplier_contacts in Neon.
// Run: npm run script scripts/10-discover.ts -- --q "fall detection sensor module" --max 20 [--1688]
import { runActor, ACTORS } from "../lib/apify";
import { sql, audit } from "../lib/db";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const Q = arg("--q", "fall detection sensor module");
const MAX = Number(arg("--max", "20"));
const TERMS = [Q, "mmwave radar fall detection module", "elderly fall detection sensor wearable"];

const pick = (o: any, keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== "") return v; } return null; };

type Norm = { name: string; source: string; source_url: string | null; country: string | null; years: number | null; verified: boolean | null; trade_assurance: boolean | null; response_rate: string | null; contact_url: string | null; email: string | null; phone: string | null; product: string | null; price: string | null; moq: string | null; raw: any };

function normAlibaba(it: any): Norm | null {
  const name = pick(it, ["supplierName", "companyName", "company", "supplier", "name", "storeName"]);
  if (!name) return null;
  return {
    name: String(name).trim(), source: "alibaba",
    source_url: pick(it, ["supplierUrl", "storeUrl", "companyUrl", "url", "productUrl", "link"]),
    country: pick(it, ["country", "location", "supplierCountry"]),
    years: Number(String(pick(it, ["years", "yearsOnAlibaba", "supplierYears", "goldYears"]) ?? "").replace(/\D/g, "")) || null,
    verified: pick(it, ["verified", "isVerified", "verifiedSupplier"]) != null ? Boolean(pick(it, ["verified", "isVerified", "verifiedSupplier"])) : null,
    trade_assurance: pick(it, ["tradeAssurance", "isTradeAssurance"]) != null ? Boolean(pick(it, ["tradeAssurance", "isTradeAssurance"])) : null,
    response_rate: pick(it, ["responseRate", "response_rate", "responseTime"]),
    contact_url: pick(it, ["contactSupplierUrl", "contactUrl", "chatUrl"]),
    email: null, phone: null,
    product: pick(it, ["productTitle", "title", "productName", "mainProducts"]),
    price: pick(it, ["price", "priceRange", "unitPrice"]), moq: pick(it, ["moq", "minOrder", "minOrderQuantity"]),
    raw: it,
  };
}

function norm1688(it: any): Norm | null {
  const name = pick(it, ["org", "companyName", "shopName", "supplierName", "name"]);
  if (!name) return null;
  const phones = it.phones ?? it.phone ?? null;
  const phone = Array.isArray(phones) ? (phones[0]?.number ?? phones[0]) : phones;
  return {
    name: String(name).trim(), source: "1688",
    source_url: pick(it, ["shopUrl", "url", "detailUrl", "link"]), country: "CN",
    years: null, verified: null, trade_assurance: null, response_rate: null,
    contact_url: pick(it, ["wangwangUrl", "wangwang", "imUrl"]), email: pick(it, ["email"]), phone: phone ? String(phone) : null,
    product: pick(it, ["title", "subject", "productName"]), price: pick(it, ["price", "priceRange"]), moq: pick(it, ["moq", "minOrder"]), raw: it,
  };
}

async function upsert(n: Norm) {
  const found = await sql`select id from suppliers where lower(name) = lower(${n.name}) and source = ${n.source} limit 1`;
  let id: number;
  if (found[0]) id = found[0].id;
  else {
    const [r] = await sql`insert into suppliers(name, source, source_url, country, years, verified, trade_assurance, response_rate, products)
      values (${n.name}, ${n.source}, ${n.source_url}, ${n.country}, ${n.years}, ${n.verified}, ${n.trade_assurance}, ${n.response_rate},
              ${JSON.stringify({ product: n.product, price: n.price, moq: n.moq, raw: n.raw })}::jsonb) returning id`;
    id = r.id;
  }
  if (n.contact_url) await sql`insert into supplier_contacts(supplier_id, channel, handle, label) values (${id}, 'alibaba', ${n.contact_url}, ${n.name}) on conflict do nothing`;
  if (n.email) await sql`insert into supplier_contacts(supplier_id, channel, handle, label) values (${id}, 'email', ${n.email}, ${n.name}) on conflict do nothing`;
  if (n.phone) await sql`insert into supplier_contacts(supplier_id, channel, handle, label) values (${id}, 'phone', ${n.phone}, ${n.name}) on conflict do nothing`;
  return id;
}

let total = 0;
try {
  console.log("Apify:", ACTORS.alibabaSuppliers, TERMS);
  const items = await runActor(ACTORS.alibabaSuppliers, { searchTerms: TERMS, maxSuppliersPerSearch: Math.ceil(MAX / TERMS.length) + 2, goldSuppliersOnly: false, tradeAssuranceOnly: false }, { maxItems: MAX * 2, timeoutSecs: 240 });
  console.log(`  ${items.length} rows; keys of first:`, Object.keys(items[0] ?? {}).join(", "));
  for (const it of items) { const n = normAlibaba(it); if (n) { await upsert(n); total++; } }
} catch (e: any) {
  console.log("  alibaba actor failed:", e.message, "→ trying fallback", ACTORS.alibabaProducts);
  try {
    const items = await runActor(ACTORS.alibabaProducts, { query: Q, maxItems: MAX }, { maxItems: MAX, timeoutSecs: 240 });
    console.log(`  ${items.length} rows; keys of first:`, Object.keys(items[0] ?? {}).join(", "));
    for (const it of items) { const n = normAlibaba(it); if (n) { await upsert(n); total++; } }
  } catch (e2: any) { console.log("  fallback failed:", e2.message); }
}

if (argv.includes("--1688")) {
  try {
    const items = await runActor(ACTORS.s1688, { mode: "search", keyword: "跌倒检测 雷达 模组", maxResults: MAX, includeLeads: true, maxLeadItems: 10, includeContactInfo: true }, { maxItems: MAX, timeoutSecs: 240 });
    console.log(`  1688: ${items.length} rows; keys:`, Object.keys(items[0] ?? {}).join(", "));
    for (const it of items) { const n = norm1688(it); if (n) { await upsert(n); total++; } }
  } catch (e: any) { console.log("  1688 actor failed:", e.message); }
}

await audit("discover", { q: Q, total });
const rows = await sql`select s.id, s.name, s.source, s.country, s.years, s.verified, (select count(*) from supplier_contacts c where c.supplier_id = s.id)::int as contacts from suppliers s order by id desc limit 40`;
console.table(rows);
console.log(`upserted ${total}`);
