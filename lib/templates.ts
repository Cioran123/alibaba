const COMPANY = process.env.COMPANY_NAME || "Sentinel Care";
const FOUNDER = process.env.FOUNDER_NAME || "Matthew";

export const SPEC_EN =
  "a fall-detection sensing module for an elderly-care device (60 GHz mmWave radar module, or 6-axis IMU + BLE 5.x pendant module), low power, CE/FCC (or test reports) and RoHS";
export const SPEC_ZH = "老人跌倒检测设备用的传感模组（60GHz毫米波雷达模组，或6轴IMU+BLE 5.x的吊坠模组），低功耗，需有CE/FCC认证或测试报告及RoHS";

export function firstContactEmail(supplierName: string, product?: string | null) {
  const subject = `Inquiry: fall-detection sensor module, 500 pcs pilot (${COMPANY})`;
  const text =
`Hello ${supplierName} team,

I'm the procurement assistant at ${COMPANY}, a US startup building a fall-detection device for elderly people. ${product ? `We saw your listing "${product}".` : ""}

We are sourcing ${SPEC_EN}. Pilot order 500 pcs, then about 5,000 per year.

Could you share:
1. Unit price at 500 / 1,000 / 5,000 pcs (FOB Shenzhen)
2. MOQ and lead time
3. Sample price and sample lead time (we pay DHL)
4. CE / FCC / RoHS certificates or test reports
5. Payment terms (we normally do 30% deposit / 70% before shipment, or Alibaba Trade Assurance)
6. Are you a factory or a trading company?

If WeChat is easier for you, please send your WeChat ID and we will add you.

您好！我们是美国一家做老人跌倒检测设备的初创公司，正在采购${SPEC_ZH}。试产500台，年需求约5000台。请报500/1000/5000的阶梯价（FOB深圳）、起订量、交期、样品费及样品交期、认证情况和付款方式。如方便，请告知您的微信号，谢谢！

Best regards,
${FOUNDER} / ${COMPANY} procurement`;
  return { subject, text };
}

export function firstContactZh(supplierName: string, product?: string | null) {
  return `您好！我们是美国一家做老人跌倒检测设备的初创公司${COMPANY}。${product ? `看到贵司的"${product}"，` : ""}想采购${SPEC_ZH}。试产500台，年需求约5000台。请问方便报一下500/1000/5000的阶梯价（FOB深圳）、起订量、交期、样品费及样品交期吗？另外请告知CE/FCC认证情况和付款方式。谢谢！`;
}

export function firstContactAlibaba(supplierName: string, product?: string | null) {
  return (
    `Hello ${supplierName}, we are ${COMPANY}, a US startup building a fall-detection device for elderly people. ` +
    `We need ${SPEC_EN}. Pilot 500 pcs, ~5,000/yr. Please quote 500/1,000/5,000 pcs FOB Shenzhen, MOQ, lead time, sample cost, and CE/FCC reports. ` +
    `If WeChat is easier, please share your WeChat ID. 谢谢！`
  );
}
