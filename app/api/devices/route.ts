import { listDevices, DEVICES } from "@/lib/mobilerun";
import { json, options } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = options;

/** GET → phones with live stream URLs for the dashboard embed. */
export async function GET() {
  try {
    const devices = await listDevices();
    return json({ devices: devices.map((d) => ({ ...d, role: d.id === DEVICES.iphone ? "wechat" : d.id === DEVICES.android ? "alibaba" : null })) });
  } catch (e: any) {
    return json({ devices: [], error: e.message }, { status: 200 });
  }
}
