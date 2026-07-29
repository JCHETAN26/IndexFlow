/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle with only the node_modules it actually uses, so the
  // container image does not need the whole pnpm workspace. Required by infra/Dockerfile.
  output: "standalone",
  // The workspace root is two levels up; without this Next traces files from apps/web only
  // and omits hoisted dependencies from the standalone output.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // Keep the native ONNX runtime out of the webpack bundle; load it at runtime.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
