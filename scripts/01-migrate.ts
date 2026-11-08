// Apply lib/schema.sql to Neon. Idempotent (create table if not exists). Run: npm run script scripts/01-migrate.ts
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const raw = readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8");
const text = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const stmts = text.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

for (const s of stmts) {
  await sql.query(s);
  console.log("ok:", s.slice(0, 60).replace(/\s+/g, " "));
}
console.log(`applied ${stmts.length} statements`);
