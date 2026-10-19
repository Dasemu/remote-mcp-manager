/** Demuxes Docker's non-tty log stream (8-byte frame headers) into plain text. */
export function demuxLogs(buf: Buffer): string {
  const out: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    out.push(buf.subarray(offset + 8, offset + 8 + size).toString("utf8"));
    offset += 8 + size;
  }
  return out.join("");
}
