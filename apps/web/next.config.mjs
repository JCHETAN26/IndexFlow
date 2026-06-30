/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the native ONNX runtime out of the webpack bundle; load it at runtime.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
