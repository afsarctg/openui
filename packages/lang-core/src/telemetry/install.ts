/**
 * Installation telemetry disclosure
 *
 * Sent during package postinstall unless telemetry is disabled:
 * - A random installation ID and a salted SHA-256 project ID
 * - Lang Core, Node.js, OS, architecture, and package-manager versions
 * - CI provider category, Docker status, project-ID source category, and schema version
 *
 * The JSON payload contains no direct PII or application-user data. It never includes
 * names, email addresses, usernames, raw Git origins, repository or project names,
 * filesystem paths, branches, commits, credentials, environment values, source code,
 * prompts, messages, generated output, component or tool definitions, errors, logs,
 * stack traces, routes, or UI interactions. As with any HTTP request, the telemetry
 * proxy and PostHog can observe the source IP as transport metadata; the script does
 * not read it or add it to the payload.
 */
import { createHash } from "node:crypto";
import { release } from "node:os";
import {
  createTelemetryStateIO,
  detectPackageManager,
  loadTelemetryState,
  showTelemetryNotice,
  type PackageManagerName,
  type ProjectIdSource,
  type TelemetryStateIO,
} from "../../../../shared/telemetry/telemetry-state.cjs";
import {
  getPostHogConfig,
  isTelemetryDisabled,
  isTruthyEnv,
  normalizeProjectIdentity,
  TELEMETRY_REQUEST_TIMEOUT_MS,
  TELEMETRY_SCHEMA_VERSION,
} from "./shared";

export { detectPackageManager, isTelemetryDisabled, isTruthyEnv, normalizeProjectIdentity };
export type { PackageManagerName, ProjectIdSource };

export const INSTALL_EVENT = "openui_lang_core_installed";

export interface InstallTelemetryProperties extends Record<string, unknown> {
  telemetry_schema_version: number;
  project_id: string;
  project_id_source: ProjectIdSource;
  lang_core_version: string;
  node_version: string;
  system_platform: string;
  system_release: string;
  system_architecture: string;
  package_manager: PackageManagerName;
  package_manager_version?: string;
  ci: boolean;
  ci_name?: string;
  is_docker: boolean;
}

export interface InstallTelemetryPayload {
  distinctId: string;
  event: typeof INSTALL_EVENT;
  properties: InstallTelemetryProperties;
}

export interface InstallTelemetryIO extends TelemetryStateIO {
  platform: string;
  architecture: string;
  release(): string;
  stdout(message: string): void;
}

export type InstallTelemetrySender = (
  payload: InstallTelemetryPayload,
  env: NodeJS.ProcessEnv,
) => Promise<void>;

export interface RunInstallTelemetryOptions {
  env?: NodeJS.ProcessEnv;
  io?: Partial<InstallTelemetryIO>;
  send?: InstallTelemetrySender;
}

export type RunInstallTelemetryResult =
  | { status: "disabled" }
  | { status: "debug"; payload: InstallTelemetryPayload }
  | { status: "sent"; payload: InstallTelemetryPayload }
  | { status: "failed"; payload?: InstallTelemetryPayload };

const INSTALL_NOTICE =
  "\n◆ OpenUI Lang Core sends pseudonymous installation telemetry to PostHog.\n" +
  "  It includes a salted project ID, OpenUI/Node/OS/package-manager metadata, and the network IP observed by PostHog.\n" +
  "  It does not send repository URLs, paths, source code, prompts, errors, or application data.\n" +
  "  Disable it with OPENUI_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1.\n\n";

export function hashProjectIdentity(salt: string, projectIdentity: string): string {
  return createHash("sha256").update(salt).update("\0").update(projectIdentity).digest("hex");
}

export async function runInstallTelemetry(
  options: RunInstallTelemetryOptions = {},
): Promise<RunInstallTelemetryResult> {
  const env = options.env ?? process.env;
  if (isTelemetryDisabled(env)) return { status: "disabled" };

  let payload: InstallTelemetryPayload | undefined;
  try {
    const io = createInstallTelemetryIO(options.io);
    const context = loadTelemetryState({ env, io });
    if (!context) return { status: "failed" };
    const { state, projectIdentity, ci, isDocker } = context;
    if (!state.projectSalt) return { status: "failed" };
    const packageManager = detectPackageManager(env);

    payload = {
      distinctId: state.distinctId,
      event: INSTALL_EVENT,
      properties: {
        telemetry_schema_version: TELEMETRY_SCHEMA_VERSION,
        project_id: hashProjectIdentity(state.projectSalt, projectIdentity.value),
        project_id_source: projectIdentity.source,
        lang_core_version:
          env["OPENUI_LANG_CORE_PACKAGE_VERSION"] || env["npm_package_version"] || "unknown",
        node_version: process.version,
        system_platform: io.platform,
        system_release: io.release(),
        system_architecture: io.architecture,
        package_manager: packageManager.name,
        ...(packageManager.version ? { package_manager_version: packageManager.version } : {}),
        ci: ci.isCI,
        ...(ci.id ? { ci_name: ci.id } : {}),
        is_docker: isDocker,
      },
    };

    showTelemetryNotice(context, "postinstall", INSTALL_NOTICE, io);

    if (isTruthyEnv(env["OPENUI_TELEMETRY_DEBUG"])) {
      io.stdout(`[OpenUI telemetry debug]\n${JSON.stringify(payload, null, 2)}\n`);
      return { status: "debug", payload };
    }

    await (options.send ?? sendToPostHog)(payload, env);
    return { status: "sent", payload };
  } catch {
    return { status: "failed", ...(payload ? { payload } : {}) };
  }
}

function createInstallTelemetryIO(overrides: Partial<InstallTelemetryIO> = {}): InstallTelemetryIO {
  return {
    ...createTelemetryStateIO(overrides),
    platform: process.platform,
    architecture: process.arch,
    release,
    stdout: (message) => process.stdout.write(message),
    ...overrides,
  };
}

async function sendToPostHog(
  payload: InstallTelemetryPayload,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const postHog = getPostHogConfig(env);
  const response = await fetch(postHog.captureUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: postHog.apiKey,
      event: payload.event,
      properties: {
        distinct_id: payload.distinctId,
        ...payload.properties,
      },
    }),
    signal: AbortSignal.timeout(TELEMETRY_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`PostHog capture failed: ${response.status}`);
}
