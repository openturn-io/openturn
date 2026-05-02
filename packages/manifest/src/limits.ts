// Hard limits enforced by both the CLI (`@openturn/deploy`, `@openturn/cli`) and
// the cloud control plane. Centralized here so the two sides can't drift.
//
// Rationale:
// - `WORKER_GZIPPED_BYTES` matches the Cloudflare Workers Free tier script-size
//   ceiling. Deploys above it would be rejected by Cloudflare with an opaque
//   error after the rest of the bundle has already been uploaded; we'd rather
//   reject up front.
// - `PER_ASSET_BYTES` / `TOTAL_ASSETS_BYTES` / `TOTAL_IMAGES_BYTES` keep games
//   loadable inside an iframe with sane bandwidth assumptions. R2 itself would
//   accept much larger objects, but the user experience past these caps is bad
//   enough that we'd rather force optimization.
export const DEPLOY_LIMITS = {
  PER_ASSET_BYTES: 25 * 1024 * 1024,
  TOTAL_ASSETS_BYTES: 25 * 1024 * 1024,
  TOTAL_IMAGES_BYTES: 25 * 1024 * 1024,
  WORKER_GZIPPED_BYTES: 3 * 1024 * 1024,
  IMAGE_EXTENSIONS: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"],
} as const;

export type DeployLimitKind =
  | "per_asset"
  | "total_assets"
  | "total_images"
  | "worker_gzipped";

export interface DeployLimitViolation {
  kind: DeployLimitKind;
  limit: number;
  actual: number;
  asset?: string;
}

export function isImageAsset(path: string): boolean {
  const lower = path.toLowerCase();
  return DEPLOY_LIMITS.IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(2)} MiB`;
}

export function describeLimitViolation(violation: DeployLimitViolation): string {
  const actual = formatBytes(violation.actual);
  const limit = formatBytes(violation.limit);
  switch (violation.kind) {
    case "per_asset":
      return `Asset ${violation.asset ?? "?"} is ${actual}; the per-asset limit is ${limit}.`;
    case "total_assets":
      return `Total bundle size is ${actual}; the total-assets limit is ${limit}.`;
    case "total_images":
      return `Total image size is ${actual}; the image-budget limit is ${limit}.`;
    case "worker_gzipped":
      return `Multiplayer worker bundle is ${actual} gzipped; the limit is ${limit}.`;
  }
}
