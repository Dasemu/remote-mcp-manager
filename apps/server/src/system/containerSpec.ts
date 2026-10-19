import type { ContainerCreateOptions, ContainerInspectInfo } from "dockerode";

/**
 * Builds the create options for a container that replaces `old` but runs `newImage`, keeping
 * everything the operator configured (name, bind mounts, port bindings, network + aliases,
 * restart policy, user-supplied env) and nothing the image itself defines.
 *
 * `oldImageEnv` is the env baked into the OLD image: those entries are dropped, otherwise a
 * `docker inspect`'d container pins the old image's ENV and a changed ENV in the new image
 * (e.g. NODE_OPTIONS) would silently never apply. Cmd/Entrypoint/Hostname are likewise left
 * out so the new image's defaults and a fresh hostname (= its own container id) apply.
 */
export function buildReplacementSpec(
  old: ContainerInspectInfo,
  oldImageEnv: string[],
  newImage: string,
): ContainerCreateOptions {
  const networkMode = old.HostConfig.NetworkMode ?? "default";
  const network = old.NetworkSettings.Networks[networkMode];
  const shortId = old.Id.slice(0, 12);

  return {
    name: old.Name.replace(/^\//, ""),
    Image: newImage,
    Env: (old.Config.Env ?? []).filter((e) => !oldImageEnv.includes(e)),
    Labels: old.Config.Labels ?? {},
    ExposedPorts: old.Config.ExposedPorts,
    User: old.Config.User || undefined,
    HostConfig: old.HostConfig,
    ...(network
      ? {
          NetworkingConfig: {
            EndpointsConfig: {
              [networkMode]: { Aliases: ((network.Aliases ?? []) as string[]).filter((a) => a !== shortId) },
            },
          },
        }
      : {}),
  };
}
