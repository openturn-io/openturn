import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  buildOpenturnProject,
  validateBundleSize,
  type BuildOpenturnProjectServerBundle,
  type OpenturnDeploymentManifest,
} from "@openturn/deploy";

export interface CloudAuthConfig {
  url: string;
  token: string;
}

export const DEFAULT_CLOUD_URL = "https://openturn.io";

export interface CloudDeployOptions {
  projectDir: string;
  projectSlug?: string;
  projectName?: string;
  config?: CloudAuthConfig;
}

export interface CloudDeployResult {
  deploymentID: string;
  projectID: string;
  url: string;
  playURL: string;
  dashboardURL: string;
  serverBundleStatus?: "none" | "uploading" | "live" | "failed";
}

function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "openturn", "auth.json");
}

export function loadCloudAuth(): CloudAuthConfig | null {
  const path = configPath();

  if (!existsSync(path)) {
    return null;
  }

  try {
    const contents = JSON.parse(readFileSync(path, "utf8")) as Partial<CloudAuthConfig>;

    if (typeof contents.url !== "string" || typeof contents.token !== "string") {
      return null;
    }

    return { url: contents.url, token: contents.token };
  } catch {
    return null;
  }
}

export function saveCloudAuth(config: CloudAuthConfig): string {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export function defaultSlug(projectDir: string): string {
  return basename(resolve(projectDir))
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function resolveCloudURL(baseURL: string, value: string): string {
  return new URL(value, `${baseURL}/`).toString();
}

export function resolveCloudPlayURL(
  baseURL: string,
  complete: { playURL: string; policyPlayURL?: string },
): string {
  return resolveCloudURL(baseURL, complete.policyPlayURL ?? complete.playURL);
}

function assetRelativePath(asset: string): string {
  if (asset.startsWith("./")) return asset.slice(2);
  if (asset.startsWith("/")) return asset.slice(1);
  return asset;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toAssetURL(assetBaseURL: string, asset: string): string {
  const cleanAsset = assetRelativePath(asset);
  const base = stripTrailingSlash(assetBaseURL);
  return `${base}/${cleanAsset}`;
}

function createCloudDeploymentHTML(manifest: OpenturnDeploymentManifest, assetBaseURL: string): string {
  const styleTags = manifest.styles
    .map((style) => `    <link rel="stylesheet" href="${escapeHTML(toAssetURL(assetBaseURL, style))}">`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHTML(manifest.gameName)}</title>
${styleTags.length > 0 ? `${styleTags}\n` : ""}  </head>
  <body>
    <div id="openturn-root"></div>
    <script>
      window.__OPENTURN_DEPLOYMENT__ = ${JSON.stringify({
        deploymentID: manifest.deploymentID,
        projectID: manifest.projectID,
        runtime: manifest.runtime,
      })};
    </script>
    <script type="module" src="${escapeHTML(toAssetURL(assetBaseURL, manifest.entry))}"></script>
  </body>
</html>
`;
}

function contentTypeForPath(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (path.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

interface SignedUploadTarget {
  asset: string;
  cacheControl?: string;
  key: string;
  contentType: string;
  uploadURL: string;
}

interface SignResponse {
  deploymentID: string;
  projectID: string;
  projectSlug: string;
  publicAssetBaseURL: string;
  r2Prefix: string;
  uploadTargets: SignedUploadTarget[];
}

export async function cloudDeploy(options: CloudDeployOptions): Promise<CloudDeployResult> {
  const config = options.config ?? loadCloudAuth();

  if (config === null) {
    throw new Error("Not signed in. Run `openturn login` first.");
  }

  const baseURL = stripTrailingSlash(config.url);

  const build = await buildOpenturnProject({
    projectDir: options.projectDir,
    outDir: join(options.projectDir, ".openturn", "deploy"),
  });

  // Reject oversized bundles client-side before we ask the cloud to presign
  // upload URLs — otherwise we'd create a pending deployment record we can't
  // fulfill, and the user would only learn about the limit after their assets
  // had been uploaded.
  validateBundleSize({
    manifest: build.manifest,
    serverBundle: build.serverBundle,
  });

  const manifest = build.manifest;
  // Precedence: --project flag > metadata.slug in app/openturn.ts > directory name.
  const projectSlug = options.projectSlug ?? build.metadata.slug ?? defaultSlug(options.projectDir);

  if (projectSlug.length === 0) {
    throw new Error(
      `Could not determine project slug for ${options.projectDir}; set "slug" in app/openturn.ts metadata or pass --project <slug>.`,
    );
  }

  const signBody = {
    projectSlug,
    ...(options.projectName !== undefined ? { projectName: options.projectName } : {}),
    manifest,
  };

  const signResponse = await fetch(`${baseURL}/api/deployments/sign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(signBody),
  });

  if (!signResponse.ok) {
    throw new Error(`Sign request failed: ${signResponse.status} ${await signResponse.text()}`);
  }

  const signData = (await signResponse.json()) as SignResponse;
  const signedManifest: OpenturnDeploymentManifest = {
    ...manifest,
    deploymentID: signData.deploymentID,
    projectID: signData.projectID,
  };
  const indexHTML = createCloudDeploymentHTML(signedManifest, signData.publicAssetBaseURL);

  try {
    await uploadAllArtifacts(build.outDir, signedManifest, indexHTML, signData);

    let serverBundleStatus: CloudDeployResult["serverBundleStatus"];

    if (signedManifest.runtime === "multiplayer") {
      if (build.serverBundle === null) {
        throw new Error("Multiplayer deployment build did not produce a server bundle.");
      }

      serverBundleStatus = await uploadServerBundle({
        baseURL,
        token: config.token,
        deploymentID: signData.deploymentID,
        bundle: build.serverBundle,
      });
    }

    const completeResponse = await fetch(`${baseURL}/api/deployments/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ deploymentID: signData.deploymentID }),
    });

    if (!completeResponse.ok) {
      throw new Error(`Complete request failed: ${completeResponse.status} ${await completeResponse.text()}`);
    }

    const complete = (await completeResponse.json()) as {
      deploymentID: string;
      projectID: string;
      playURL: string;
      dashboardURL: string;
      policyPlayURL?: string;
    };

    return {
      deploymentID: complete.deploymentID,
      projectID: complete.projectID,
      url: baseURL,
      playURL: resolveCloudPlayURL(baseURL, complete),
      dashboardURL: resolveCloudURL(baseURL, complete.dashboardURL),
      ...(serverBundleStatus === undefined ? {} : { serverBundleStatus }),
    };
  } catch (error) {
    await deleteSignedDeployment(baseURL, config.token, signData.deploymentID);
    throw error;
  }
}

async function uploadServerBundle(input: {
  baseURL: string;
  token: string;
  deploymentID: string;
  bundle: BuildOpenturnProjectServerBundle;
}): Promise<NonNullable<CloudDeployResult["serverBundleStatus"]>> {
  const moduleBytes = readFileSync(input.bundle.path);
  const metadataBytes = readFileSync(input.bundle.metadataPath);

  const form = new FormData();
  form.set(
    "metadata",
    new Blob([metadataBytes], { type: "application/json" }),
    "metadata.json",
  );
  form.set(
    input.bundle.metadata.main_module,
    new Blob([moduleBytes as unknown as BlobPart], {
      type: "application/javascript+module",
    }),
    input.bundle.metadata.main_module,
  );

  const response = await fetch(`${input.baseURL}/api/deployments/${input.deploymentID}/script`, {
    method: "POST",
    headers: {
      "X-Openturn-Bundle-Digest": input.bundle.digest,
      Authorization: `Bearer ${input.token}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Server script upload failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    status?: NonNullable<CloudDeployResult["serverBundleStatus"]>;
  };

  return payload.status ?? "live";
}

async function uploadAllArtifacts(
  outDir: string,
  manifest: OpenturnDeploymentManifest,
  indexHTML: string,
  signData: SignResponse,
): Promise<void> {
  await Promise.all(
    signData.uploadTargets.map(async (target) => {
      const asset = target.asset === "manifest.json" || target.asset === "index.html"
        ? target.asset
        : assetRelativePath(target.asset);
      const localPath = resolve(outDir, asset);

      if (target.asset !== "manifest.json" && target.asset !== "index.html" && !existsSync(localPath)) {
        throw new Error(`Expected artifact not found: ${localPath}`);
      }

      const body = bodyForUploadTarget(target.asset, localPath, manifest, indexHTML);
      let response: Response;

      try {
        response = await fetch(target.uploadURL, {
          method: "PUT",
          headers: {
            "Content-Type": target.contentType || contentTypeForPath(asset),
            ...(target.cacheControl === undefined ? {} : { "Cache-Control": target.cacheControl }),
          },
          body,
        });
      } catch (error) {
        const uploadOrigin = new URL(target.uploadURL).origin;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Upload failed for ${asset}: unable to connect to ${uploadOrigin}. ${message}`);
      }

      if (!response.ok) {
        throw new Error(`Upload failed for ${asset}: ${response.status} ${await response.text()}`);
      }
    }),
  );
}

function bodyForUploadTarget(
  asset: string,
  localPath: string,
  manifest: OpenturnDeploymentManifest,
  indexHTML: string,
): BodyInit {
  if (asset === "manifest.json") {
    return `${JSON.stringify(manifest, null, 2)}\n`;
  }

  if (asset === "index.html") {
    return indexHTML;
  }

  return readFileSync(localPath);
}

async function deleteSignedDeployment(baseURL: string, token: string, deploymentID: string): Promise<void> {
  try {
    await fetch(`${baseURL}/api/deployments/${deploymentID}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Keep the original deploy failure as the user-facing error.
  }
}
