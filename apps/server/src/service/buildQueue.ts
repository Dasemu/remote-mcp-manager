import { createSerialQueue } from "../util/serialQueue.js";

// Builds are the heaviest thing the host does (nixpacks + docker build); running several at
// once on a small host is what pushes it into swap. Serialize them — including the manager's
// own self-update build.
export const enqueueBuild = createSerialQueue();
