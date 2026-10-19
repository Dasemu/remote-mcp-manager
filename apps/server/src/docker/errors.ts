/** True when a dockerode call failed because the target container (or image) doesn't exist. */
export function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { statusCode?: unknown }).statusCode === 404;
}

/** True for HTTP 304: docker-modem surfaces "already started/stopped" as an error, but it means the container is already in the wanted state. */
export function isNotModifiedError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { statusCode?: unknown }).statusCode === 304;
}
