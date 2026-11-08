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
      `You are operating WeChat (微信) on an iPhone. Send one message to the contact whose name/remark is exactly "${contact}".\n` +
      `Steps: 1) Go to the Chats (微信) tab. 2) Tap the search icon at the top, type "${contact}", and open the matching contact/chat. ` +
      `3) Tap the text input at the bottom. The message is already on the clipboard: long-press the input and tap Paste (粘贴). If Paste is not offered, type this text exactly: "${text}". ` +
      `4) Tap Send (发送). 5) Confirm the newest green bubble on the right equals the message and return it as last_bubble. ${COMMON_RULES}`,
    outputSchema: SEND_SCHEMA,
    systemPrompt: "You control a real person's WeChat on a real iPhone. Be precise and conservative. Chinese UI labels may appear; 微信=Chats, 通讯录=Contacts, 发送=Send, 粘贴=Paste.",
    maxSteps: 40,
    vision: true,
  };
}

export function wechatReadTask(maxChats = 8) {
  return {
    task:
      `You are operating WeChat (微信) on an iPhone. Collect new incoming messages. ` +
      `Steps: 1) Go to the Chats tab. 2) For each chat that shows an unread red badge (at most ${maxChats}), open it, read the newest messages (at most 10, newest at the bottom), then go back. ` +
      `Incoming bubbles (left, white) are from="supplier"; our bubbles (right, green) are from="us". For voice notes, long-press the bubble and tap 转文字 (Convert to Text) if available, otherwise kind="voice" with text="[voice note]". ` +
      `For images use kind="image" and describe briefly. Return every chat you opened, even if the only new message is an image. Do not type or send anything. ${COMMON_RULES}`,
    outputSchema: READ_SCHEMA,
    systemPrompt: "You control a real person's WeChat on a real iPhone. Read only. Never send, never delete.",
    maxSteps: 80,
    vision: true,
  };
}

export function alibabaSendTask(target: { supplierName: string; url?: string | null }, text: string) {
  const open = target.url
    ? `Open this link: ${target.url} (if the phone asks, open it in the Alibaba.com app; otherwise continue in the browser, where we are logged in).`
    : `Open the Alibaba.com app, search for "${target.supplierName}", and open the supplier's store or product page.`;
  return {
    task:
      `You are operating the Alibaba.com buyer app on Android (already logged in). Send one inquiry to supplier "${target.supplierName}".\n` +
      `Steps: 1) ${open} 2) Tap "Contact Supplier" or "Chat now" to open the chat with the supplier. ` +
      `3) Tap the message input. The message is on the clipboard: long-press and Paste. If Paste is not offered, type it exactly: "${text}". 4) Tap Send. ` +
      `5) Confirm the newest outgoing bubble equals the message and return it as last_bubble. ${COMMON_RULES}`,
    outputSchema: SEND_SCHEMA,
    systemPrompt: "You are a careful human buyer using the Alibaba.com app. Dismiss promotional popups. Never place orders, never request quotations through forms unless told, only chat.",
    maxSteps: 45,
    vision: false,
  };
}

export function alibabaReadTask(maxThreads = 8) {
  return {
    task:
      `You are operating the Alibaba.com buyer app on Android (already logged in). Collect new supplier replies. ` +
      `Steps: 1) Open the Messenger / Messages tab. 2) For each conversation with an unread badge (at most ${maxThreads}), open it, read the newest messages (at most 10), then go back. ` +
      `Supplier messages are from="supplier"; ours are from="us". Use the supplier/company name shown at the top of the chat as "contact". ` +
      `Also include any quotation cards (price, MOQ) as text. Do not type or send anything. ${COMMON_RULES}`,
    outputSchema: READ_SCHEMA,
    systemPrompt: "You are a careful human buyer using the Alibaba.com app. Read only. Dismiss popups.",
    maxSteps: 80,
    vision: false,
  };
}
