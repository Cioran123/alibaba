// Read-only WeChat smoke test on the tethered iPhone: lists the top chats, sends nothing.
// Run: npm run script scripts/23-wechat-smoke.ts
import { DEVICES, runTaskAndWait, saveTaskEvidence } from "../lib/mobilerun";

if (!DEVICES.iphone) throw new Error("MOBILERUN_IPHONE_DEVICE_ID not set");
const r = await runTaskAndWait({
  deviceId: DEVICES.iphone,
  task: "Open WeChat (微信). Go to the Chats tab. Return the display names of the top 6 chats in order and whether each has an unread badge. Do not open any chat, do not type, do not send anything. Then press Home.",
  outputSchema: { type: "object", properties: { chats: { type: "array", items: { type: "object", properties: { name: { type: "string" }, unread: { type: "boolean" } }, required: ["name", "unread"] } }, error: { type: ["string", "null"] } }, required: ["chats", "error"] },
  systemPrompt: "You control a real person's iPhone. Be careful and minimal. Read only.",
  maxSteps: 20, timeoutSec: 240, vision: true,
}, { onStatus: (s) => console.log("   ", s) });
console.log(JSON.stringify(r.output ?? r.message, null, 1));
console.log("evidence:", await saveTaskEvidence(r.taskId));
