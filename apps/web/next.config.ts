import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  transpilePackages: ["@mailart/envelope", "@mailart/db", "@mailart/emails"],
  serverExternalPackages: ["postgres", "nodemailer"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
