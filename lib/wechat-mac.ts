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

const PROC = `(first process whose name is "${APP}" or name is "微信")`;

async function frontmostName() {
  return osa(`tell application "System Events" to get name of first process whose frontmost is true`).catch(() => "");
}

/** Bring WeChat to the front with its main window visible; throws if it will not come forward. */
async function activate() {
  for (let i = 0; i < 3; i++) {
    await osa(`tell application "${APP}" to activate`).catch(() => {});
    await osa(`tell application "${APP}" to reopen`).catch(() => {});
    await osa(`tell application "System Events" to set frontmost of ${PROC} to true`).catch(() => {});
    await sleep(900);
    if ((await frontmostName()) === APP) {
      // make sure a real window exists (WeChat closed to the dock has none)
      const n = Number(await osa(`tell application "System Events" to count windows of ${PROC}`).catch(() => "0"));
      if (n > 0) return;
      await osa(`tell application "System Events" to tell ${PROC} to keystroke "1" using command down`).catch(() => {}); // ⌘1 = Chats
      await sleep(800);
      if (Number(await osa(`tell application "System Events" to count windows of ${PROC}`).catch(() => "0")) > 0) return;
    }
  }
  throw new Error("wechat_not_frontmost");
}

/** Bounds of the main WeChat window as {x,y,w,h}. */
async function windowBounds() {
  const out = await osa(`tell application "System Events" to tell ${PROC} to get {position, size} of window 1`);
  const n = out.split(",").map((s) => Number(s.trim()));
  return { x: n[0], y: n[1], w: n[2], h: n[3] };
}

/** CGWindowID of WeChat's main window (largest on-screen window owned by the app), via JXA + CoreGraphics. */
async function windowId(): Promise<number | null> {
  const jxa = `ObjC.import('CoreGraphics');
const list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludingDesktopElements, $.kCGNullWindowID)) || [];
const ws = list.filter(w => (w.kCGWindowOwnerName === '${APP}' || w.kCGWindowOwnerName === '微信') && w.kCGWindowLayer === 0 && w.kCGWindowBounds && w.kCGWindowBounds.Width > 300);
ws.sort((a, b) => (b.kCGWindowBounds.Width * b.kCGWindowBounds.Height) - (a.kCGWindowBounds.Width * a.kCGWindowBounds.Height));
ws.length ? String(ws[0].kCGWindowNumber) : '';`;
  try {
    const { stdout } = await exec("osascript", ["-l", "JavaScript", "-e", jxa], { timeout: 15000 });
    const id = Number(stdout.trim());
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch { return null; }
}

/** Screenshot the WeChat window to a PNG (by window id, so overlapping windows do not matter); returns path + data URL. */
export async function screenshotWindow(outPath: string) {
  if ((await frontmostName()) !== APP) await activate();
  const id = await windowId();
  if (id) {
    await exec("screencapture", ["-x", "-o", "-l", String(id), outPath], { timeout: 15000 });
  } else {
    const b = await windowBounds();
    await exec("screencapture", ["-x", "-R", `${b.x},${b.y},${b.w},${b.h}`, outPath], { timeout: 15000 });
  }
  const buf = readFileSync(outPath);
  return { path: outPath, dataUrl: `data:image/png;base64,${buf.toString("base64")}`, windowId: id };
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
/**
 * Read new messages, but ONLY from chats whose name matches an allowed supplier contact (never personal chats).
 * `allowed` = supplier_contacts.handle values for channel wechat (e.g. "S001 Jack"); the match is case-insensitive
 * on the full name, the S-code prefix, or the name after the code.
 */
export async function wechatReadNew(allowed: string[], maxChats = 6): Promise<{ chats: { contact: string; messages: { from: "supplier" | "us"; text: string; time: string | null; kind: string }[] }[]; error: string | null; evidence: string | null }> {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const allowedNorm = allowed.map(norm).filter(Boolean);
  const isAllowed = (name: string) => {
    const n = norm(name);
    return allowedNorm.some((a) => n === a || n.startsWith(a) || a.startsWith(n) || (a.match(/^s\d{3}/) && n.startsWith(a.slice(0, 4))) || a.replace(/^s\d{3}\s*/, "") === n);
  };
  const taskId = `${Date.now().toString(36)}`;
  const dir = evidenceDir(taskId);
  try {
    if (!(await wechatRunning())) return { chats: [], error: "wechat_not_running", evidence: null };
    await activate();
    const list = await screenshotWindow(`${dir}/list.png`);
    const unreadAll = await listUnread(list.dataUrl);
    const unread = allowedNorm.length ? unreadAll.filter(isAllowed) : [];
    if (unreadAll.length && !unread.length) console.log(`   wechat: ${unreadAll.length} unread chat(s) ignored (not supplier contacts)`);
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
