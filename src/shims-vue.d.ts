declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, any>;
  export default component;
}

// vue-router v4 ships its own types under a subpath that this tsconfig's
// module resolution doesn't pick up; declare the entry point loosely.
declare module 'vue-router' {
  import type { App } from 'vue';
  export interface RouteRecordRaw {
    path: string;
    name?: string;
    component?: unknown;
    props?: boolean | Record<string, unknown>;
    [key: string]: unknown;
  }
  export interface Router {
    push(to: string | { name?: string; params?: Record<string, unknown> }): Promise<unknown>;
    replace(to: string): void;
    currentRoute: { value: { params: Record<string, unknown>; fullPath: string } };
  }
  export function createRouter(options: {
    history: unknown;
    routes: RouteRecordRaw[];
  }): Router & { install(app: App): void };
  export function createWebHashHistory(base?: string): unknown;
}
