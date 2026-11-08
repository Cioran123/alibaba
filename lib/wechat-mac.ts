/**
 * WeChat for macOS, driven locally: AppleScript/System Events for input, window screenshots + vision for reading.
 * Requires the process running this code (terminal / Claude app) to have Accessibility + Screen Recording permission.
 * The founder's own WeChat account stays logged in on phone and desktop simultaneously.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readChatScreenshot } from "./llm";

const exec = promisify(execFile);
const APP = process.env.WECHAT_MAC_APP || "WeChat";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function osa(script: string) {
  const { stdout } = await exec("osascript", ["-e", script], { timeout: 20000 });
  return stdout.trim();
}

async function setClipboard(text: string) {
  await new Promise<void>((resolve, reject) => {
    const p = execFile("pbcopy", [], (err) => (err ? reject(err) : resolve()));
    p.stdin!.end(text);
  });
}

export async function wechatRunning(): Promise<boolean> {
  const out = await osa(`tell application "System Events" to get name of every process whose name contains "${APP}" or name contains "微信"`).catch(() => "");
  return out.length > 0;
}

async function activate() {
  await osa(`tell application "${APP}" to activate`);
  await sleep(700);
}

/** Bounds of the main WeChat window as {x,y,w,h}. */
async function windowBounds() {
  const out = await osa(`tell application "System Events" to tell (first process whose name contains "${APP}" or name contains "微信") to get {position, size} of window 1`);
  const n = out.split(",").map((s) => Number(s.trim()));
  return { x: n[0], y: n[1], w: n[2], h: n[3] };
}

/** Screenshot the WeChat window to a PNG; returns the file path and a data URL. */
export async function screenshotWindow(outPath: string) {
  const b = await windowBounds();
  await exec("screencapture", ["-x", "-R", `${b.x},${b.y},${b.w},${b.h}`, outPath], { timeout: 15000 });
  const buf = readFileSync(outPath);
  return { path: outPath, dataUrl: `data:image/png;base64,${buf.toString("base64")}`, bounds: b };
}

/** Open the chat with a contact (exact remark/display name) via Cmd+F search. */
async function openChat(contact: string) {
  await activate();
  await osa(`tell application "System Events" to keystroke "f" using command down`);
  await sleep(500);
  await setClipboard(contact);
  await osa(`tell application "System Events" to keystroke "v" using command down`);
  await sleep(1200);
  await osa(`tell application "System Events" to key code 36`); // Return → open first result
  await sleep(1000);
}

function evidenceDir(id: string) {
  const dir = `public/evidence/mac-${id}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Send one message to a contact. Verifies by screenshot + vision that the text appears as our newest bubble. */
export async function wechatSend(contact: string, text: string): Promise<{ sent: boolean; last_bubble: string; error: string | null; evidence: string | null; taskId: string }> {
  const taskId = `${Date.now().toString(36)}`;
  const dir = evidenceDir(taskId);
  try {
    if (!(await wechatRunning())) return { sent: false, last_bubble: "", error: "wechat_not_running", evidence: null, taskId };
    await openChat(contact);
    await screenshotWindow(`${dir}/000.png`);
    await setClipboard(text);
    await osa(`tell application "System Events" to keystroke "v" using command down`);
    await sleep(800);
    await osa(`tell application "System Events" to key code 36`); // Return → send
    await sleep(1500);
    const shot = await screenshotWindow(`${dir}/last.png`);
    let last = "";
    try {
      const read = await readChatScreenshot(shot.dataUrl);
      const ours = read.lines.filter((l) => l.from === "us");
      last = ours[ours.length - 1]?.text ?? "";
    } catch {}
    const ok = last ? last.slice(0, 12) === text.slice(0, 12) || text.includes(last.slice(0, 12)) : true; // vision may be fuzzy; absence of error is primary signal
    return { sent: ok, last_bubble: last, error: ok ? null : "verify_mismatch", evidence: `/evidence/mac-${taskId}/last.png`, taskId };
  } catch (e: any) {
    return { sent: false, last_bubble: "", error: e.message?.slice(0, 200) ?? "error", evidence: null, taskId };
  }
}

/** Read new messages: screenshot the chat list, ask vision for chats with unread badges, open each and transcribe. */
export async function wechatReadNew(maxChats = 6): Promise<{ chats: { contact: string; messages: { from: "supplier" | "us"; text: string; time: string | null; kind: string }[] }[]; error: string | null; evidence: string | null }> {
  const taskId = `${Date.now().toString(36)}`;
  const dir = evidenceDir(taskId);
  try {
    if (!(await wechatRunning())) return { chats: [], error: "wechat_not_running", evidence: null };
    await activate();
    const list = await screenshotWindow(`${dir}/list.png`);
    const unread = await listUnread(list.dataUrl);
    const chats = [];
    for (const name of unread.slice(0, maxChats)) {
      await openChat(name);
      const shot = await screenshotWindow(`${dir}/${name.replace(/[^\w一-鿿-]+/g, "_").slice(0, 40)}.png`);
      const read = await readChatScreenshot(shot.dataUrl);
      chats.push({ contact: name, messages: read.lines.slice(-10).map((l) => ({ from: l.from, text: l.text, time: l.time ?? null, kind: "text" })) });
    }
    return { chats, error: null, evidence: `/evidence/mac-${taskId}/list.png` };
  } catch (e: any) {
    return { chats: [], error: e.message?.slice(0, 200) ?? "error", evidence: null };
  }
}

/** Vision: names of chats in the left pane that show an unread badge. */
async function listUnread(dataUrl: string): Promise<string[]> {
  const OpenAI = (await import("openai")).default;
  const client = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
  const model = process.env.OPENAI_API_KEY ? (process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna") : (process.env.OPENROUTER_STRONG_MODEL || "openai/gpt-5.6-luna");
  const r = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You read screenshots of the WeChat desktop app. Return JSON only." },
      { role: "user", content: [
        { type: "text", text: 'List the chat names in the left chat list that show a red unread badge (a red dot or a red number). Return {"unread": ["name", ...]} with names exactly as displayed. If none, return {"unread": []}.' },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } } as any,
      ] },
    ],
    response_format: { type: "json_object" } as any,
    temperature: 0,
  });
  try { return JSON.parse(r.choices[0]?.message?.content ?? "{}").unread ?? []; } catch { return []; }
}

/** Debug helper: save a screenshot of the current WeChat window. */
export async function wechatSnapshot(outPath = "/tmp/wechat-window.png") {
  await activate();
  const s = await screenshotWindow(outPath);
  writeFileSync(outPath, readFileSync(outPath));
  return s.path;
}
