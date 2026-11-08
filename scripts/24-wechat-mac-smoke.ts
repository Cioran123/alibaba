// WeChat desktop smoke test: activates WeChat, screenshots the window, lists chats with unread badges. Sends nothing.
// Run: npm run script scripts/24-wechat-mac-smoke.ts
import { wechatRunning, wechatSnapshot, wechatReadNew } from "../lib/wechat-mac";
console.log("wechat running:", await wechatRunning());
console.log("snapshot:", await wechatSnapshot("/tmp/wechat-window.png"));
const r = await wechatReadNew([], 2); // empty allowlist: reports unread chats but opens none
console.log(JSON.stringify(r, null, 1).slice(0, 1500));
