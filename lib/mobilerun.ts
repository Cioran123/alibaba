import Mobilerun from "@mobilerun/sdk";

// Reads MOBILERUN_CLOUD_API_KEY from env by default.
export const mobilerun = new Mobilerun({ apiKey: process.env.MOBILERUN_CLOUD_API_KEY || "missing-MOBILERUN_CLOUD_API_KEY" });

export const DEVICES = {
  /** Cloud Android with the Alibaba.com app logged in (virtual is fine for Alibaba). */
  android: process.env.MOBILERUN_ANDROID_DEVICE_ID || "",
  /** Tethered personal iPhone with WeChat logged in (never a virtual device for WeChat). */
  iphone: process.env.MOBILERUN_IPHONE_DEVICE_ID || "",
};

export type TaskResult = {
  taskId: string;
  status: string;
  succeeded: boolean;
  output: Record<string, unknown> | null;
  message: string | null;
  steps: number | null;
};

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one natural-language task on a device and wait for it. One task per device at a time —
 * callers must serialize per device (see worker in scripts/32-poll-inboxes.ts).
 */
export async function runTaskAndWait(
  p: {
    deviceId: string; task: string; outputSchema?: Record<string, unknown>; systemPrompt?: string;
    maxSteps?: number; timeoutSec?: number; vision?: boolean; humanize?: boolean; llmModel?: string;
  },
  opts: { pollMs?: number; onStatus?: (s: string) => void } = {},
): Promise<TaskResult> {
  const timeoutSec = Math.min(p.timeoutSec ?? 600, 2700);
  const run = await mobilerun.tasks.run({
    deviceId: p.deviceId,
    task: p.task,
    outputSchema: p.outputSchema ?? null,
    systemPrompt: p.systemPrompt ?? null,
    maxSteps: p.maxSteps ?? 60,
    executionTimeout: timeoutSec,
    vision: p.vision ?? false,
    humanize: p.humanize ?? true,
    ...(p.llmModel ? { llmModel: p.llmModel } : {}),
  });
  const deadline = Date.now() + (timeoutSec + 90) * 1000;
  let last = "";
  while (Date.now() < deadline) {
    const s = await mobilerun.tasks.getStatus(run.id);
    if (s.status !== last) { last = s.status; opts.onStatus?.(s.status); }
    if (TERMINAL.has(s.status)) {
      return {
        taskId: run.id, status: s.status, succeeded: Boolean(s.succeeded ?? s.status === "completed"),
        output: (s.output as Record<string, unknown>) ?? null, message: s.message ?? null, steps: s.steps ?? null,
      };
    }
    await sleep(opts.pollMs ?? 4000);
  }
  try { await mobilerun.tasks.stop(run.id); } catch {}
  return { taskId: run.id, status: "timeout", succeeded: false, output: null, message: "client-side timeout", steps: null };
}

/**
 * Save the first/middle/last trajectory screenshots of a task under public/evidence/<taskId>/ and
 * return the public path of the final frame (served by Next from /evidence/...). Best-effort.
 */
export async function saveTaskEvidence(taskId: string): Promise<string | null> {
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const shots: any = await mobilerun.tasks.screenshots.list(taskId);
    // The API lists frames lexicographically (0,1,10,11,…,2,20,…); order them by their numeric file name.
    const num = (u: string) => Number((u.split("?")[0].match(/\/(\d+)\.png$/) || [])[1] ?? -1);
    const urls: string[] = [...(shots?.urls ?? [])].sort((a, b) => num(a) - num(b));
    if (!urls.length) return null;
    const dir = `public/evidence/${taskId}`;
    mkdirSync(dir, { recursive: true });
    const idx = [...new Set([0, Math.floor(urls.length / 2), urls.length - 2, urls.length - 1])].filter((i) => i >= 0);
    for (const i of idx) {
      const r = await fetch(urls[i]);
      if (!r.ok) continue;
      writeFileSync(`${dir}/${i === urls.length - 1 ? "last" : String(num(urls[i])).padStart(3, "0")}.png`, Buffer.from(await r.arrayBuffer()));
    }
    return `/evidence/${taskId}/last.png`;
  } catch {
    return null;
  }
}

/** Put text on the device clipboard (used for Chinese input: paste instead of typing). */
export async function setClipboard(deviceId: string, text: string) {
  await mobilerun.devices.clipboard.set(deviceId, { text } as any);
}

export async function listDevices() {
  const r = await mobilerun.devices.list();
  return (r.items ?? []).map((d) => ({ id: d.id, name: d.name, platform: d.platform, state: d.state, type: d.type, streamUrl: d.streamUrl, activeTaskId: d.activeTaskId }));
}
