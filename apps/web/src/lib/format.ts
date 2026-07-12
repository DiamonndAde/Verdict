/** Truncate a base58 key in the middle: `GcEBPh…W5U8e`. */
export function short(key: string, head = 4, tail = 4): string {
  if (key.length <= head + tail + 1) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

/** dUSDC has 6 decimals. */
export function dusdc(raw: bigint | number | string): number {
  return Number(BigInt(raw.toString())) / 1e6;
}

export function fmtDusdc(raw: bigint | number | string): string {
  return dusdc(raw).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

/** Deterministic hue from a pubkey, for identicon-style accents. */
export function keyHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}
