let next = 1;

/** Ids for pooled objects sent to network clients: a reused pool member gets a fresh id per spawn. */
export function nextNetId(): number {
  next = (next + 1) & 0xffff || 1;
  return next;
}
