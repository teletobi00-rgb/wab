// Shape of the Electron preload bridge exposed on window.wab. Undefined when
// running in a plain browser (npm run dev without Electron).
interface WabBridge {
  setUnread: (count: number) => void;
  setAutoLaunch: (enabled: boolean) => void;
  getAutoLaunch: () => Promise<boolean>;
}

interface Window {
  wab?: WabBridge;
}
