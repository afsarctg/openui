"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { normalizeProjectIdentity } = require("./project-identity.cjs");

function createTelemetryStateIO(overrides = {}) {
  return {
    cwd: () => process.cwd(),
    homedir: os.homedir,
    readFile: (file) => fs.readFileSync(file, "utf8"),
    writeFile: (file, contents, options) => fs.writeFileSync(file, contents, options),
    mkdir: (directory) => fs.mkdirSync(directory, { recursive: true, mode: 0o700 }),
    exists: fs.existsSync,
    link: fs.linkSync,
    rename: fs.renameSync,
    unlink: fs.unlinkSync,
    randomUUID: crypto.randomUUID,
    randomHex: (bytes) => crypto.randomBytes(bytes).toString("hex"),
    ci: () => {
      const { isCI, id } = require("ci-info");
      return { isCI, id };
    },
    isDocker: () => {
      if (fs.existsSync("/.dockerenv")) return true;
      try {
        return /docker|containerd|kubepods/i.test(fs.readFileSync("/proc/self/cgroup", "utf8"));
      } catch {
        return false;
      }
    },
    runCommand: (file, args, cwd, env) =>
      execFileSync(file, args, {
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
        windowsHide: true,
      }).trim(),
    getGitOrigin: (root) => {
      try {
        return execFileSync("git", ["-C", root, "config", "--get", "remote.origin.url"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1000,
          windowsHide: true,
        }).trim();
      } catch {
        return undefined;
      }
    },
    stderr: (message) => process.stderr.write(message),
    ...overrides,
  };
}

function detectPackageManager(env) {
  const match = env["npm_config_user_agent"]?.trim().match(/^(npm|pnpm|yarn|bun)\/([^\s]+)/i);
  if (!match) return { name: "unknown" };
  return { name: match[1].toLowerCase(), version: match[2].slice(0, 64) };
}

function resolveProjectIdentity(projectRoot, env, io) {
  const origin = io.getGitOrigin(projectRoot)?.trim();
  if (origin) return { value: normalizeProjectIdentity(origin), source: "git_origin" };
  const repository = env["REPOSITORY_URL"]?.trim();
  if (repository) return { value: normalizeProjectIdentity(repository), source: "repository_url" };
  return { value: projectRoot, source: "install_root" };
}

function packageCacheRoot(env, io, root) {
  let manager = detectPackageManager(env);
  if (manager.name === "unknown") {
    // Direct CLI invocations lack npm_config_user_agent. Walk up for workspace config.
    for (let directory = root; ; directory = path.dirname(directory)) {
      try {
        const configured = JSON.parse(
          io.readFile(path.join(directory, "package.json")),
        ).packageManager;
        if (typeof configured === "string") {
          manager = detectPackageManager({ npm_config_user_agent: configured.replace("@", "/") });
        }
      } catch {
        // CLI invocations need not happen inside a project.
      }
      if (manager.name !== "unknown") break;
      for (const [lock, name, version] of [
        ["pnpm-lock.yaml", "pnpm", ""],
        ["yarn.lock", "yarn", undefined],
        ["bun.lock", "bun", ""],
        ["bun.lockb", "bun", ""],
        ["package-lock.json", "npm", ""],
        ["npm-shrinkwrap.json", "npm", ""],
      ]) {
        if (io.exists(path.join(directory, lock))) {
          manager = { name, version };
          break;
        }
      }
      if (
        manager.name !== "unknown" ||
        io.exists(path.join(directory, ".git")) ||
        path.dirname(directory) === directory
      )
        break;
    }
  }
  const query = (args) => {
    const executable = env["npm_execpath"];
    if (executable && /\.[cm]?js$/i.test(executable)) {
      return io.runCommand(process.execPath, [executable, ...args], root, env).trim();
    }
    return io.runCommand(executable || manager.name, args, root, env).trim();
  };
  let directory;
  switch (manager.name) {
    case "npm":
      directory = env["npm_config_cache"]?.trim() || query(["config", "get", "cache"]);
      break;
    case "pnpm":
      directory = query(["store", "path", "--silent"]);
      break;
    case "yarn":
      if ((manager.version || query(["--version"])).startsWith("1.")) {
        directory = query(["cache", "dir"]);
      } else {
        // Project-local Yarn caches delete unknown entries and may be checked into Git.
        if (query(["config", "get", "enableGlobalCache"]) !== "true") return undefined;
        directory = query(["config", "get", "cacheFolder"]);
      }
      break;
    case "bun":
      directory = env["BUN_INSTALL_CACHE_DIR"]?.trim() || query(["pm", "cache"]);
      break;
    default:
      return undefined;
  }
  if (!directory || directory === "undefined" || directory === "null") return undefined;
  return path.resolve(root, directory);
}

function readState(file, io, requireProjectSalt = true) {
  let contents;
  try {
    contents = io.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  let state;
  try {
    state = JSON.parse(contents);
  } catch {
    // Corrupt JSON is repaired without treating filesystem errors as corruption.
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
  return {
    state,
    valid:
      typeof state.distinctId === "string" &&
      Boolean(state.distinctId) &&
      ((typeof state.projectSalt === "string" && Boolean(state.projectSalt)) ||
        (!requireProjectSalt && state.projectSalt === undefined)),
  };
}

function initializeState(file, state, io, requireProjectSalt, replace = false) {
  io.mkdir(path.dirname(file));
  const temporary = `${file}.${io.randomUUID()}.tmp`;
  let createdTemporary = false;
  try {
    io.writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    createdTemporary = true;
    if (replace) {
      io.rename(temporary, file);
      createdTemporary = false;
      return state;
    }
    try {
      // Publish complete bytes without replacing a winner from another process.
      io.link(temporary, file);
      return state;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const winner = readState(file, io, requireProjectSalt);
      if (!winner?.valid) throw new Error("Telemetry identity unavailable during initialization");
      return winner.state;
    }
  } finally {
    if (createdTemporary) {
      try {
        io.unlink(temporary);
      } catch {
        // Cleanup must not affect a successfully published identity.
      }
    }
  }
}

function loadTelemetryState(options = {}) {
  const env = options.env ?? process.env;
  const io = createTelemetryStateIO(options.io);
  try {
    const ci = io.ci();
    const isDocker = io.isDocker();
    const projectRoot = path.resolve(env["INIT_CWD"] || io.cwd());
    const projectIdentity = resolveProjectIdentity(projectRoot, env, io);
    const localFile = path.join(
      env["XDG_CONFIG_HOME"] || path.join(io.homedir(), ".config"),
      "openui",
      "telemetry.json",
    );
    let file = localFile;
    if (env["OPENUI_TELEMETRY_STATE_DIR"]?.trim()) {
      file = path.resolve(projectRoot, env["OPENUI_TELEMETRY_STATE_DIR"], "telemetry.json");
    } else if (ci.isCI || isDocker) {
      try {
        const cacheRoot = packageCacheRoot(env, io, projectRoot);
        if (cacheRoot) {
          const key =
            projectIdentity.source === "install_root"
              ? "unscoped"
              : crypto.createHash("sha256").update(projectIdentity.value).digest("hex");
          file = path.join(cacheRoot, ".openui", "telemetry", key, "telemetry.json");
        }
      } catch {
        // Unknown or unavailable cache adapters retain the normal configuration location.
      }
    }
    const requireProjectSalt = options.requireProjectSalt !== false;
    const existing = readState(file, io, requireProjectSalt);
    if (existing?.valid) return { state: existing.state, file, ci, isDocker, projectIdentity };
    let state = existing?.state;
    if (!existing && file !== localFile) {
      // One-time import only; the selected cache remains authoritative afterward.
      state = readState(localFile, io, requireProjectSalt)?.state;
    }
    state = {
      ...state,
      distinctId:
        typeof state?.distinctId === "string" && state.distinctId
          ? state.distinctId
          : io.randomUUID(),
      projectSalt:
        typeof state?.projectSalt === "string" && state.projectSalt
          ? state.projectSalt
          : io.randomHex(16),
    };
    return {
      state: initializeState(file, state, io, requireProjectSalt, Boolean(existing)),
      file,
      ci,
      isDocker,
      projectIdentity,
    };
  } catch {
    if (/^(1|true)$/i.test(env["OPENUI_TELEMETRY_DEBUG"] || "")) {
      io.stderr(
        "[OpenUI telemetry] Identity state could not be read or initialized; telemetry skipped.\n",
      );
    }
    return undefined;
  }
}

function showTelemetryNotice(context, kind, message, overrides = {}) {
  const io = createTelemetryStateIO(overrides);
  const legacyFlag = kind === "cli" ? "firstRunNoticeShown" : "langCorePostinstallNoticeShown";
  if (context.state[legacyFlag] === true) return;
  const marker = path.join(path.dirname(context.file), `${kind}-notice-shown`);
  if (io.exists(marker)) return;
  io.stderr(message);
  try {
    io.writeFile(marker, "1\n", { mode: 0o600, flag: "wx" });
  } catch {
    // Identity state is never rewritten to acknowledge notices.
  }
}

module.exports = {
  createTelemetryStateIO,
  detectPackageManager,
  loadTelemetryState,
  showTelemetryNotice,
};
