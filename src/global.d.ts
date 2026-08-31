import type { KaraApi } from './preload';

declare global {
  interface Window {
    kara: KaraApi;
  }
}

export {};
