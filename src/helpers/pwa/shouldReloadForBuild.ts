import { splitBuildId } from "../version/buildId";

export function shouldReloadForBuild(appVersion: unknown, buildId: unknown): boolean {
  const app = String(appVersion ?? "").trim();
  if (!app) return false;
  const build = splitBuildId(buildId);
  if (!build.version) return false;
  return build.version !== app;
}

