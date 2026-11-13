import type { NextConfig } from "next";

const backendApiUrl = (process.env.BACKEND_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  agentRules: false,
  // 关闭开发模式左下角的 Next.js 角标（会盖住侧栏的「设置」）
  devIndicators: false,
  // RunningHub 工作流、视频生成可能要几分钟，转发请求不要 30 秒就断开
  experimental: { proxyTimeout: 15 * 60 * 1000 },
  async rewrites() {
    return [
      {
        source: '/code/:path*',
        destination: `${backendApiUrl}/code/:path*`,
      },
      {
        source: '/api/sessions',
        destination: `${backendApiUrl}/api/sessions`,
      },
      {
        source: '/api/sessions/:path*',
        destination: `${backendApiUrl}/api/sessions/:path*`,
      },
      // 工作流 API
      {
        source: '/api/project/:path*',
        destination: `${backendApiUrl}/api/project/:path*`,
      },
      {
        source: '/api/stages',
        destination: `${backendApiUrl}/api/stages`,
      },
      {
        source: '/api/scenarios',
        destination: `${backendApiUrl}/api/scenarios`,
      },
      {
        source: '/api/scenarios/:path*',
        destination: `${backendApiUrl}/api/scenarios/:path*`,
      },
      {
        source: '/api/upload_media',
        destination: `${backendApiUrl}/api/upload_media`,
      },
      {
        source: '/api/upload_file',
        destination: `${backendApiUrl}/api/upload_file`,
      },
      {
        source: '/api/models',
        destination: `${backendApiUrl}/api/models`,
      },
      {
        source: '/api/config',
        destination: `${backendApiUrl}/api/config`,
      },
      {
        source: '/api/cache/:path*',
        destination: `${backendApiUrl}/api/cache/:path*`,
      },
      // 一键 pipeline API
      {
        source: '/api/pipelines',
        destination: `${backendApiUrl}/api/pipelines`,
      },
      {
        source: '/api/pipelines/:path*',
        destination: `${backendApiUrl}/api/pipelines/:path*`,
      },
      {
        source: '/api/tasks',
        destination: `${backendApiUrl}/api/tasks`,
      },
      {
        source: '/api/tasks/:path*',
        destination: `${backendApiUrl}/api/tasks/:path*`,
      },
      // 画布与作品图库
      {
        source: '/api/canvas/:path*',
        destination: `${backendApiUrl}/api/canvas/:path*`,
      },
      {
        source: '/api/gallery/:path*',
        destination: `${backendApiUrl}/api/gallery/:path*`,
      },
      {
        source: '/api/providers/:path*',
        destination: `${backendApiUrl}/api/providers/:path*`,
      },
      // 临时工作台 API
      {
        source: '/api/sandbox/:path*',
        destination: `${backendApiUrl}/api/sandbox/:path*`,
      },
    ];
  },
};

export default nextConfig;
