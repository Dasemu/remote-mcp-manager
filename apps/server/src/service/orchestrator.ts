import {
  type Installation,
  type HostVolume,
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
  stopContainer,
  startContainer,
  restartContainer,
  waitForContainerHealth,
  getImageId,
  removeImageIfUnused,
} from "../docker/containers.js";
import { generateBearerToken } from "../crypto/secrets.js";
import { enqueueBuild } from "./buildQueue.js";

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
    publishHostPort?: number | null;
    hostVolumes?: HostVolume[];
  },
): Installation {
  return updateInstallation(id, patch);
}

interface BuildOutcome {
  installation: Installation;
  ok: boolean;
}

export async function buildInstallation(id: string): Promise<Installation> {
  return (await enqueueBuild(() => runBuild(id))).installation;
}

async function runBuild(id: string): Promise<BuildOutcome> {
  const installation = getInstallationById(id);
  if (!installation) throw new Error("installation not found");

  // A build never touches the running container, so a running installation keeps its
  // "running" status (and keeps being served by the proxy) throughout, whether the build
  // succeeds or fails. Any other installation shows the build's progress/failure instead.
  const wasRunning = installation.status === "running";
  if (!wasRunning) updateInstallation(id, { status: "building", statusDetail: null });
  const fail = (detail: string): BuildOutcome => ({
    installation: updateInstallation(id, { status: wasRunning ? "running" : "error", statusDetail: detail }),
    ok: false,
  });

  // The clone on disk is otherwise only ever made once, at draft creation — without this,
  // every "rebuild" silently reused that same stale checkout forever, never picking up new
  // commits pushed to the repo afterwards.
  try {
    await cloneOrUpdateRepo(installation.slug, installation.repoUrl, installation.gitRef);
  } catch (err) {
    return fail(`git pull failed: ${(err as Error).message}`);
  }

  const imageTag = `mcpmgr/${installation.slug}:latest`;
  const previousImageId = installation.imageTag ? await getImageId(installation.imageTag) : undefined;

  const result = await runNixpacksBuild(
    installation.slug,
    repoDir(installation.slug),
    imageTag,
    installation.startCommand,
  );

  if (!result.success) {
    return fail(`build failed, see log at ${result.logPath}`);
  }

  // Nixpacks moves the tag to the new image, leaving the previous one dangling — clean it up
  // so rebuilds don't accumulate untagged images forever.
  if (previousImageId) {
    const newImageId = await getImageId(imageTag);
    if (newImageId && newImageId !== previousImageId) {
      await removeImageIfUnused(previousImageId);
    }
  }

  return {
    installation: updateInstallation(id, { status: wasRunning ? "running" : "built", statusDetail: null, imageTag }),
    ok: true,
  };
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
    // A failed build must stop here: deploying anyway would silently redeploy the previous image
    // and report success, hiding the failure.
    const built = await enqueueBuild(() => runBuild(id));
    if (!built.ok) return built.installation;
  }
  return deployInstallation(id);
}

// Start/restart act on the existing container, so they never apply changed env/config (that
// needs a deploy, which recreates it). If the container is gone (e.g. pruned after a host
// reboot) they fall back to a deploy from the built image.
async function resumeInstallation(
  id: string,
  act: (containerName: string) => Promise<boolean>,
): Promise<Installation> {
  const installation = getInstallationById(id);
  if (!installation) throw new Error("installation not found");

  updateInstallation(id, { status: "starting", statusDetail: null });

  try {
    if (!(await act(installation.containerName))) {
      if (!installation.imageTag) {
        throw new Error("container does not exist and the installation has no built image — build it first");
      }
      return await deployInstallation(id);
    }
    await waitForContainerHealth(installation);

    const bearerToken = installation.bearerToken ?? generateBearerToken();
    return updateInstallation(id, { status: "running", statusDetail: null, bearerToken });
  } catch (err) {
    return updateInstallation(id, { status: "error", statusDetail: (err as Error).message });
  }
}

export const startInstallation = (id: string) => resumeInstallation(id, startContainer);

export const restartInstallation = (id: string) => resumeInstallation(id, restartContainer);

/** Stops the container without removing it; it stays stopped (restart policy `unless-stopped`) until started again. */
export async function stopInstallation(id: string): Promise<Installation> {
  const installation = getInstallationById(id);
  if (!installation) throw new Error("installation not found");

  try {
    // A missing container is already stopped as far as the operator is concerned.
    await stopContainer(installation.containerName);
    return updateInstallation(id, { status: "stopped", statusDetail: null });
  } catch (err) {
    return updateInstallation(id, { status: "error", statusDetail: (err as Error).message });
  }
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
