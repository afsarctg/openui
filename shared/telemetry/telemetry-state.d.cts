import type { WriteFileOptions } from "node:fs";

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun" | "unknown";
export type ProjectIdSource = "git_origin" | "repository_url" | "install_root";
export interface TelemetryStateIO {
  cwd(): string;
  homedir(): string;
  readFile(file: string): string;
  writeFile(file: string, contents: string, options?: WriteFileOptions): void;
  mkdir(directory: string): void;
  exists(file: string): boolean;
  link(existing: string, destination: string): void;
  unlink(file: string): void;
  randomUUID(): string;
  randomHex(bytes: number): string;
  ci(): { isCI: boolean; id: string | null };
  isDocker(): boolean;
  runCommand(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): string;
  getGitOrigin(projectRoot: string): string | undefined;
  stderr(message: string): void;
}
export interface TelemetryStateContext {
  state: {
    distinctId: string;
    projectSalt?: string;
    firstRunNoticeShown?: boolean;
    langCorePostinstallNoticeShown?: boolean;
    [key: string]: unknown;
  };
  file: string;
  ci: { isCI: boolean; id: string | null };
  isDocker: boolean;
  projectIdentity: { value: string; source: ProjectIdSource };
}
export function createTelemetryStateIO(overrides?: Partial<TelemetryStateIO>): TelemetryStateIO;
export function detectPackageManager(env: NodeJS.ProcessEnv): {
  name: PackageManagerName;
  version?: string;
};
export function loadTelemetryState(options?: {
  env?: NodeJS.ProcessEnv;
  io?: Partial<TelemetryStateIO>;
  requireProjectSalt?: boolean;
}): TelemetryStateContext | undefined;
export function showTelemetryNotice(
  context: TelemetryStateContext,
  kind: "cli" | "postinstall",
  message: string,
  io?: Partial<TelemetryStateIO>,
): void;
