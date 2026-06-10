import type { NextConfig } from "next";

// GitHub Pages 정적 배포(https://harrykane11.github.io/ghost/) 기준.
// 로컬 dev/일반 빌드에선 basePath 없이 동작하도록 GHOST_PAGES=1일 때만 적용한다.
const isPages = process.env.GHOST_PAGES === "1";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isPages ? "/ghost" : "",
  images: { unoptimized: true },   // 정적 export에는 이미지 최적화 서버가 없다
};

export default nextConfig;
