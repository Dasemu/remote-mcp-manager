import {
  type Installation,
  createInstallation,
  updateInstallation,
  getInstallationById,
  getInstallationBySlug,
  slugify,
} from "../db/installations.js";
import { cloneOrUpdateRepo, readEnvExampleKeys, repoDir } from "../build/git.js";
import { runNixpacksBuild } from "../build/nixpacks.js";
import {
  runInstallationContainer,
  stopInstallationContainer,
  waitForContainerHealth,
  getImageId,
  removeImageIfUnused,
} from "../docker/containers.js";
import { generateBearerToken } from "../crypto/secrets.js";

export interface DraftResult {
  installation: Installation;
  detectedEnvKeys: string[];
}

export async function createDraftInstallation(input: {
  name: string;
  repoUrl: string;
  gitRef?: string;
}): Promise<DraftResult> {
  const slug = slugify(input.name);
  if (getInstallationBySlug(slug)) {
    throw new Error(`an installation with slug "${slug}" already exists`);
  }
  const installation = createInstallation({ name: input.name, slug, repoUrl: input.repoUrl, gitRef: input.gitRef });

  try {
    updateInstallation(installation.id, { status: "cloning" });
    const dir = await cloneOrUpdateRepo(slug, input.repoUrl, input.gitRef);
    const detectedEnvKeys = readEnvExampleKeys(dir);
    const updated = updateInstallation(installation.id, { status: "draft", statusDetail: null });
    return { installation: updated, detectedEnvKeys };
  } catch (err) {
    const updated = updateInstallation(installation.id, { status: "error", statusDetail: (err as Error).message });
    return { installation: updated, detectedEnvKeys: [] };
  }
}

export function configureInstallation(
  id: string,
  patch: {
    env?: Record<string, string>;
    portEnvVar?: string;
    hostEnvVar?: string;
    httpPath?: string;
    internalPort?: number;
    basicAuthUsername?: string | null;
    basicAuthPassword?: string | null;
    startCommand?: string | null;
  },
): Installation {
  return updateInstallation(id, patch);
}

export async function buildInstallation(id: string): Promise<Installation> {
  const installation = getInstallationById(id);
  if (!installation) throw new Error("installation not found");

  updateInstallation(id, { status: "building", statusDetail: null });
  const imageTag = `mcpmgr/${installation.slug}:latest`;
  const previousImageId = installation.imageTag ? await getImageId(installation.imageTag) : undefined;

  const result = await runNixpacksBuild(
    installation.slug,
    repoDir(installation.slug),
    imageTag,
    installation.startCommand,
  );

  if (!result.success) {
    return updateInstallation(id, {
      status: "error",
      statusDetail: `build failed, see log at ${result.logPath}`,
    });
  }

  // Nixpacks moves the tag to the new image, leaving the previous one dangling — clean it up
  // so rebuilds don't accumulate untagged images forever.
  if (previousImageId) {
    const newImageId = await getImageId(imageTag);
    if (newImageId && newImageId !== previousImageId) {
      await removeImageIfUnused(previousImageId);
    }
  }

  return updateInstallation(id, { status: "built", statusDetail: null, imageTag });
}

export async function deployInstallation(id: string): Promise<Installation> {
  let installation = getInstallationById(id);
  if (!installation) throw new Error("installation not found");

  updateInstallation(id, { status: "starting", statusDetail: null });

  try {
    await runInstallationContainer(installation);
    await waitForContainerHealth(installation);

    const bearerToken = installation.bearerToken ?? generateBearerToken();
    return updateInstallation(id, { status: "running", statusDetail: null, bearerToken });
  } catch (err) {
    return updateInstallation(id, { status: "error", statusDetail: (err as Error).message });
  }
}

export async function redeployInstallation(id: string, opts: { rebuild?: boolean } = {}): Promise<Installation> {
  if (opts.rebuild) {
    await buildInstallation(id);
  }
  return deployInstallation(id);
}

export async function removeInstallationContainer(id: string): Promise<void> {
  const installation = getInstallationById(id);
  if (!installation) return;
  await stopInstallationContainer(installation.containerName);

  if (installation.imageTag) {
    const imageId = await getImageId(installation.imageTag);
    if (imageId) await removeImageIfUnused(imageId);
  }
}
