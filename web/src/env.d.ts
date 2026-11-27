/// <reference types="vite/client" />

declare module 'virtual:wx-app' {
  import type { PageConfig } from './runtime/router';
  export const appStyles: string;
  export const pages: {
    route: string;
    render: (ctx: unknown, cache: unknown[]) => unknown;
    templates: Record<string, (ctx: unknown, cache: unknown[]) => unknown>;
    css: string;
    config: PageConfig;
  }[];
}
