export type InstallPhase = "configure" | "preparing" | "installing" | "completed" | "failed";

export type InstallLocation = {
  readonly installParentPath: string;
  readonly installPath: string;
  readonly requiredBytes: number;
  readonly availableBytes: number;
};

export type InstallActivity = {
  readonly id: string;
  readonly label: string;
  readonly state: "pending" | "active" | "completed";
};

export type HostMessage =
  | { readonly type: "host.ready"; readonly payload: InstallLocation }
  | { readonly type: "directory.selected"; readonly payload: InstallLocation }
  | { readonly type: "install.phase"; readonly payload: { readonly phase: InstallPhase } }
  | { readonly type: "install.progress"; readonly payload: { readonly written: number; readonly total: number } }
  | { readonly type: "install.activities"; readonly payload: { readonly activities: readonly InstallActivity[] } }
  | { readonly type: "install.failure"; readonly payload: { readonly message: string } };

type InstallerHost = {
  readonly postMessage: (message: unknown) => void;
  readonly addEventListener: (type: "message", listener: (event: MessageEvent<HostMessage>) => void) => void;
  readonly removeEventListener: (type: "message", listener: (event: MessageEvent<HostMessage>) => void) => void;
};

declare global {
  interface Window {
    chrome?: { readonly webview?: InstallerHost };
    __zhiwubuyanInstallerMock?: InstallerHost;
  }
}

function host(): InstallerHost | undefined {
  return window.chrome?.webview ?? window.__zhiwubuyanInstallerMock;
}

export function sendHostCommand(command: Readonly<Record<string, unknown>>): void {
  host()?.postMessage(command);
}

export function subscribeToHost(listener: (message: HostMessage) => void): () => void {
  const current = host();
  if (current === undefined) return () => undefined;
  const handler = (event: MessageEvent<HostMessage>) => listener(event.data);
  current.addEventListener("message", handler);
  return () => current.removeEventListener("message", handler);
}
