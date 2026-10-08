import type { Installation } from "../api/client";

const LABELS: Record<Installation["status"], string> = {
  draft: "Draft",
  cloning: "Cloning",
  building: "Building",
  built: "Built",
  starting: "Starting",
  running: "Running",
  stopped: "Stopped",
  error: "Error",
};

export function StatusBadge({ status }: { status: Installation["status"] }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" />
      {LABELS[status]}
    </span>
  );
}
