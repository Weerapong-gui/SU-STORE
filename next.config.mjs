/** @type {import('next').NextConfig} */
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
