"use strict";

// Browser-safe: installation and runtime telemetry must normalize origins identically.
function normalizeProjectIdentity(rawValue) {
  const value = rawValue.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const repositoryPath = normalizeRepositoryPath(decodeURIComponent(url.pathname));
    if (url.protocol === "file:") return `file:${repositoryPath}`;
    if (url.host) return joinHostAndPath(url.host, repositoryPath);
  } catch {
    // SCP-style Git origins and local paths are handled below.
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) return normalizeRepositoryPath(value);
  const scpMatch = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(value);
  if (scpMatch) return joinHostAndPath(scpMatch[1], scpMatch[2]);
  return normalizeRepositoryPath(value);
}

function joinHostAndPath(host, repositoryPath) {
  const normalizedHost = host.trim().toLowerCase();
  const normalizedPath = normalizeRepositoryPath(repositoryPath);
  return normalizedPath ? `${normalizedHost}/${normalizedPath}` : normalizedHost;
}

function normalizeRepositoryPath(repositoryPath) {
  return repositoryPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
}

module.exports = { normalizeProjectIdentity };
