import { sourcingBrief, simulateSellerReply } from "../lib/llm";
const b = await sourcingBrief("60 GHz mmWave radar module for fall detection of elderly people, low power, CE/FCC, 500 pcs pilot then ~5,000/yr", "Sentinel Care");
console.log(b);
console.log("\n---\n", await simulateSellerReply({ supplierName: "Shenzhen Hi-Link Electronic Co., Ltd.", product: "HLK-LD6002B 60GHz fall detection radar module", inquiry: b.rfq_en, listing: { price: "$9.80-12.50", moq: "2 pcs" } }));
process.exit(0);
