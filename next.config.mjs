/** @type {import('next').NextConfig} */

if (process.env.NODE_ENV === "production") {
  if (!process.env.COOKIE_SECRET) {
    throw new Error("[SU-STORE] COOKIE_SECRET ต้องตั้งค่าใน production เพื่อป้องกัน cookie forgery");
  }
  if (process.env.COOKIE_SECRET.length < 32) {
    throw new Error("[SU-STORE] COOKIE_SECRET ต้องมีความยาวอย่างน้อย 32 ตัวอักษร");
  }
}

const orderApiHost = process.env.ORDER_API_BASE_URL
  ? new URL(process.env.ORDER_API_BASE_URL).hostname
  : null;

const nextConfig = {
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: orderApiHost
      ? [
          {
            protocol: "http",
            hostname: orderApiHost,
            pathname: "/product-images/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
