/**
 * Natural-language task definitions for the Mobilerun phone agent, with strict output schemas.
 * WeChat runs on a cloud Android (second account), Alibaba.com on another cloud Android: the official app when
 * ALIBABA_MODE=app (accessibility tree, deterministic Messenger/RFQ), otherwise the mobile website in Chrome.
 */

export const SEND_SCHEMA = {
  type: "object",
  properties: {
    sent: { type: "boolean" },
    last_bubble: { type: "string" },
    error: { type: ["string", "null"] },
  },
  required: ["sent", "last_bubble", "error"],
};

export const READ_SCHEMA = {
  type: "object",
  properties: {
    chats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          contact: { type: "string", description: "remark / display name exactly as shown" },
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string", enum: ["supplier", "us"] },
                text: { type: "string" },
                time: { type: ["string", "null"] },
                kind: { type: "string", enum: ["text", "image", "voice", "file", "other"] },
              },
              required: ["from", "text", "time", "kind"],
            },
          },
        },
        required: ["contact", "messages"],
      },
    },
  },
  required: ["chats"],
};

const COMMON_RULES =
  "Rules: act like a careful human. Never send anything except the exact message given. Never add contacts, change settings, or open other apps. " +
  "If a security/verification prompt appears, stop immediately and return error='security_prompt'. If the contact cannot be found, return error='not_found'.";

export function wechatSendTask(contact: string, text: string) {
  return {
    task:
      `You are operating WeChat (微信) on a phone. Send one message to the contact whose name/remark is exactly "${contact}".\n` +
      `Steps: 1) Go to the Chats (微信) tab. 2) Tap the search icon at the top, type "${contact}", and open the matching contact/chat. ` +
      `3) Tap the text input at the bottom. The message is already on the clipboard: long-press the input and tap Paste (粘贴). If Paste is not offered, type this text exactly: "${text}". ` +
      `4) Tap Send (发送). 5) Confirm the newest green bubble on the right equals the message and return it as last_bubble. ${COMMON_RULES}`,
    outputSchema: SEND_SCHEMA,
    systemPrompt: "You control a company WeChat account on a phone. Be precise and conservative. Chinese UI labels may appear; 微信=Chats, 通讯录=Contacts, 发送=Send, 粘贴=Paste.",
    maxSteps: 40,
    vision: process.env.WECHAT_VISION === "1",
  };
}

export function wechatReadTask(maxChats = 8, allowed: string[] = []) {
  const scope = allowed.length
    ? `Only open chats whose name is one of these supplier contacts (ignore every other chat): ${allowed.map((a) => `"${a}"`).join(", ")}. `
    : `Only open chats whose name starts with "S0" followed by digits (supplier contacts); ignore every other chat. `;
  return {
    task:
      `You are operating WeChat (微信) on a phone. Collect new incoming messages from supplier contacts. ${scope}` +
      `Steps: 1) Go to the Chats tab. 2) For each allowed chat that shows an unread red badge (at most ${maxChats}), open it, read the newest messages (at most 10, newest at the bottom), then go back. ` +
      `Incoming bubbles (left, white) are from="supplier"; our bubbles (right, green) are from="us". For voice notes, long-press the bubble and tap 转文字 (Convert to Text) if available, otherwise kind="voice" with text="[voice note]". ` +
      `For images use kind="image" and describe briefly. Return every chat you opened, even if the only new message is an image. Do not type or send anything. ${COMMON_RULES}`,
    outputSchema: READ_SCHEMA,
    systemPrompt: "You control a company WeChat account on a phone. Read only. Never send, never delete.",
    maxSteps: 80,
    vision: process.env.WECHAT_VISION === "1",
  };
}

/** ALIBABA_MODE=app → drive the official Alibaba.com buyer app (com.alibaba.intl.android.apps.poseidon); anything else → mobile web in Chrome. */
export const ALIBABA_APP = process.env.ALIBABA_MODE === "app";
/** The Alibaba.com app is Flutter: its accessibility tree is mostly empty, so app tasks run with vision on. */
const APP_VISION = process.env.ALIBABA_VISION !== "0";

const ALIBABA_SYSTEM = ALIBABA_APP
  ? "You are a careful human buyer using the official Alibaba.com app on an Android phone (already logged in). Stay inside the app; never open Chrome. " +
    "Dismiss promotional popups, coupon sheets and notification prompts. Never place orders, never pay, never fill RFQ forms unless told, only chat."
  : "You are a careful human buyer using Alibaba.com on an Android phone. Use the Alibaba.com app if it is installed; otherwise use Chrome with the mobile website (we are already logged in). " +
    "Dismiss promotional popups, app-install banners and cookie prompts. Never place orders, never fill RFQ forms unless told, only chat.";

const APP_NOT_LOGGED_IN = `If the app shows a sign-in / login screen, return error='not_logged_in'. If a slider captcha or verification appears, return error='captcha'.`;

function alibabaAppSendTask(target: { supplierName: string; product?: string | null }, text: string) {
  return {
    task:
      `Send one inquiry to the Alibaba.com supplier "${target.supplierName}" using the Alibaba.com app.\n` +
      `Steps: 1) Open the Alibaba.com app (orange icon). ${APP_NOT_LOGGED_IN} ` +
      `2) Tap the search bar at the top, type "${target.supplierName}" and search. If the results show a "Suppliers" / "Manufacturers" tab at the top, tap it and open the company whose name matches; otherwise open the first product result from that company and tap the company name to reach its store page. ` +
      `3) Tap the orange "Chat now" / "Contact Supplier" / "Send inquiry" button. If an inquiry FORM opens (product name + quantity + requirements), use it: tap the requirements box; if a CHAT window opens, tap the message input at the bottom. ` +
      `4) The message is already on the clipboard: long-press the input and tap Paste. If Paste is not offered, type it exactly: "${text}". 5) Tap Send. ` +
      `6) Success = the message appears as your newest bubble in the chat, or a "sent successfully" confirmation. Return sent=true and last_bubble = the first 60 characters of the message. ` +
      `If the supplier cannot be found after two searches, return error='not_found'. ${COMMON_RULES}`,
    outputSchema: SEND_SCHEMA,
    systemPrompt: ALIBABA_SYSTEM,
    maxSteps: 60,
    vision: APP_VISION,
  };
}

function alibabaAppReadTask(maxThreads = 8) {
  return {
    task:
      `Collect new supplier replies in the Alibaba.com app. ` +
      `Steps: 1) Open the Alibaba.com app. ${APP_NOT_LOGGED_IN} 2) Tap the "Messenger" tab in the bottom bar. ` +
      `3) For each conversation with an unread badge or bold preview (at most ${maxThreads}), open it, read the newest messages (at most 10, newest at the bottom), then go back to the list. ` +
      `Supplier messages (left) are from="supplier"; ours (right) are from="us". Use the supplier/company name shown at the top of the chat as "contact". ` +
      `Quotation cards, product cards and price offers must be written out as text (price, MOQ, lead time). Skip "Alibaba.com" system/notification conversations. Do not type or send anything. ${COMMON_RULES}`,
    outputSchema: READ_SCHEMA,
    systemPrompt: ALIBABA_SYSTEM + " Read only.",
    maxSteps: 80,
    vision: APP_VISION,
  };
}

export const RFQ_SCHEMA = {
  type: "object",
  properties: { posted: { type: "boolean" }, confirmation: { type: "string" }, error: { type: ["string", "null"] } },
  required: ["posted", "confirmation", "error"],
};

/** Post one RFQ in the Alibaba.com app (the mobile-web form never loaded in Chrome). Details text must already be on the clipboard. */
export function alibabaAppRfqTask(product: string, quantity: number, detailsPreview: string) {
  return {
    task:
      `Post exactly ONE Request for Quotation (RFQ) in the Alibaba.com app.\n` +
      `1) Open the Alibaba.com app. ${APP_NOT_LOGGED_IN} ` +
      `2) Find the RFQ entry: look on the Home tab for a tile or link named "Request for Quotation", "RFQ", "Get Quotations" or "Post sourcing request" (often just under the search bar or in the quick links); if not there, tap the "Me" tab → "My RFQ" / "RFQ" → "+ Post RFQ"; if still not found, type "fall detection module" in search and look for "Post a sourcing request" / "Can't find what you need?" at the top or bottom of the results. ` +
      `3) In the form: Product name = "${product}". Quantity = ${quantity}, unit Pieces. Detailed requirements / description: the text is on the clipboard — long-press the box and Paste (it starts with "${detailsPreview}"); if Paste is not offered, type the text. ` +
      `If a category is required, pick Sensors / Electronic Components; if a shipping term is asked, pick FOB; leave attachments and optional fields empty. ` +
      `4) Tick any required agreement and tap the submit button ("Post RFQ" / "Submit" / "Post now"). 5) Confirmation looks like "RFQ submitted" / "posted successfully" / a page showing your new RFQ. Return posted=true and the confirmation text. ` +
      `Never post more than one RFQ. If the form cannot be found after trying all entry points, return error='form_not_found'. ${COMMON_RULES.replace("Never send anything except the exact message given. ", "")}`,
    outputSchema: RFQ_SCHEMA,
    systemPrompt: ALIBABA_SYSTEM.replace("never fill RFQ forms unless told, ", ""),
    maxSteps: 70,
    vision: APP_VISION,
  };
}

export function alibabaSendTask(target: { supplierName: string; url?: string | null; product?: string | null }, text: string) {
  if (ALIBABA_APP) return alibabaAppSendTask(target, text);
  const open = target.url
    ? `Open Chrome and go to this exact link: ${target.url}`
    : `Open Chrome, go to https://www.alibaba.com, search for "${target.supplierName}", open the supplier's product page and tap "Contact supplier".`;
  return {
    task:
      `Send one inquiry to the Alibaba.com supplier "${target.supplierName}" using the website in Chrome (we are logged in).\n` +
      `Steps: 1) ${open} Wait up to 10 seconds for the "Contact supplier" / "Send message" page (it may be in Russian: "Отправить сообщение"). ` +
      `If the page is blank, pull down to refresh once and wait 10 seconds. If a "Translate page?" bar appears, dismiss it or tap Translate — either is fine. ` +
      `2) Tap the large message box labelled "Detailed requirements" / "Подробные требования" / "Please type in". ` +
      `3) The message is already on the clipboard: long-press the box and tap Paste (Вставить). If Paste is not offered, type it exactly: "${text}". ` +
      `4) Leave the quantity field as it is. Tap the orange button "Send inquiry now" / "Отправить". ` +
      `5) Success looks like "Your inquiry was sent successfully" / "Ваш запрос успешно отправлен". Return sent=true and last_bubble = the first 60 characters of the message you pasted. ` +
      `If a login page appears, return error='not_logged_in'. If a captcha/slider appears, return error='captcha'. ` +
      `NEVER open Chrome's three-dot menu, never toggle "Desktop site", never open new tabs, never use the address bar except to open the link in step 1. ${COMMON_RULES}`,
    outputSchema: SEND_SCHEMA,
    systemPrompt: ALIBABA_SYSTEM,
    maxSteps: 70,
    vision: false,
  };
}

export function alibabaReadTask(maxThreads = 8) {
  if (ALIBABA_APP) return alibabaAppReadTask(maxThreads);
  return {
    task:
      `Collect new supplier replies on Alibaba.com. ` +
      `Steps: 1) Open the Messenger: in the app it is the "Messenger" tab; on the mobile website open https://message.alibaba.com in Chrome. ` +
      `2) For each conversation with an unread badge (at most ${maxThreads}), open it, read the newest messages (at most 10), then go back. ` +
      `Supplier messages are from="supplier"; ours are from="us". Use the supplier/company name shown at the top of the chat as "contact". ` +
      `Include quotation cards (price, MOQ, lead time) as text. Do not type or send anything. If a login page appears, return no chats and error='not_logged_in'. ${COMMON_RULES}`,
    outputSchema: READ_SCHEMA,
    systemPrompt: ALIBABA_SYSTEM + " Read only.",
    maxSteps: 80,
    vision: false,
  };
}
