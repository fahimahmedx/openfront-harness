/// <reference types="vite/client" />

declare global {
  interface Window {
    showPage?: (pageId: string) => void;
  }
}

export {};
