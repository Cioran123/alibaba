/**
 * Natural-language task definitions for the Mobilerun phone agent, with strict output schemas.
 * WeChat runs on the tethered iPhone (vision), Alibaba.com app on the cloud Android (accessibility tree).
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

export function wechatReadTask(maxChats = 8) {
  return {
    task:
      `You are operating WeChat (微信) on a phone. Collect new incoming messages. ` +
      `Steps: 1) Go to the Chats tab. 2) For each chat that shows an unread red badge (at most ${maxChats}), open it, read the newest messages (at most 10, newest at the bottom), then go back. ` +
      `Incoming bubbles (left, white) are from="supplier"; our bubbles (right, green) are from="us". For voice notes, long-press the bubble and tap 转文字 (Convert to Text) if available, otherwise kind="voice" with text="[voice note]". ` +
      `For images use kind="image" and describe briefly. Return every chat you opened, even if the only new message is an image. Do not type or send anything. ${COMMON_RULES}`,
    outputSchema: READ_SCHEMA,
    systemPrompt: "You control a company WeChat account on a phone. Read only. Never send, never delete.",
    maxSteps: 80,
    vision: process.env.WECHAT_VISION === "1",
  };
}

const ALIBABA_SYSTEM =
  "You are a careful human buyer using Alibaba.com on an Android phone. Use the Alibaba.com app if it is installed; otherwise use Chrome with the mobile website (we are already logged in). " +
  "Dismiss promotional popups, app-install banners and cookie prompts. Never place orders, never fill RFQ forms unless told, only chat.";

export function alibabaSendTask(target: { supplierName: string; url?: string | null }, text: string) {
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
