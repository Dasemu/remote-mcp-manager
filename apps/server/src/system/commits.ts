export interface CommitSummary {
  sha: string;
  subject: string;
}

const SHA_RE = /^[0-9a-f]{7,40}$/;

/** Accepts a baked-in/inspected SHA only if it is plain hex; "unknown" and junk become undefined. */
export function normalizeSha(raw: string | undefined): string | undefined {
  const sha = raw?.trim().toLowerCase();
  return sha && SHA_RE.test(sha) ? sha : undefined;
}

/** Parses `git log --format=%h%x09%s` output. */
export function parseCommitLog(output: string): CommitSummary[] {
  return output
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [sha, ...rest] = line.split("\t");
      return { sha: sha!.trim(), subject: rest.join("\t").trim() };
    });
}
