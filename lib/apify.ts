import { ApifyClient } from "apify-client";

export const apify = new ApifyClient({ token: process.env.APIFY_TOKEN });

/** Run an actor synchronously (≤ ~4 min) and return its dataset items. */
export async function runActor<T = Record<string, any>>(
  actorId: string,
  input: Record<string, unknown>,
  opts: { maxItems?: number; timeoutSecs?: number; maxTotalChargeUsd?: number } = {},
): Promise<T[]> {
  const run = await apify.actor(actorId).call(input, {
    timeout: opts.timeoutSecs ?? 240,
    waitSecs: opts.timeoutSecs ?? 240,
    maxItems: opts.maxItems,
    maxTotalChargeUsd: opts.maxTotalChargeUsd ?? 2,
  } as any);
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  return items as T[];
}

export const ACTORS = {
  alibabaSuppliers: "rel8ble/alibaba-supplier-search-scraper",
  alibabaProducts: "silentflow/alibaba-scraper",
  s1688: "lentic_clockss/1688-global-scraper",
  madeInChina: "scrapesage/made-in-china-scraper",
  contactInfo: "vdrmota/contact-info-scraper",
};
