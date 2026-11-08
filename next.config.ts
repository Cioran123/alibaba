import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the SDKs out of the bundler (agentmail dynamically imports optional deps like @x402/fetch).
  serverExternalPackages: ["@neondatabase/serverless", "agentmail", "@mobilerun/sdk", "@usenaive-sdk/managed-agents", "openai", "apify-client"],
};

export default nextConfig;
