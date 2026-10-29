export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Hash of a binary mask, prefixed with its shape so equal bytes of different shapes differ. */
export async function maskHash(width: number, height: number, mask: Uint8Array): Promise<string> {
  if (mask.length !== width * height) throw new RangeError('Mask does not match dimensions');
  const head = new TextEncoder().encode(`mask1:${width}x${height}:`);
  const all = new Uint8Array(head.length + mask.length);
  all.set(head, 0);
  all.set(mask, head.length);
  return sha256Bytes(all);
}

/** A mask revision is only valid for the baseline it was drawn on. */
export async function maskRevisionId(basePixelHash: string, width: number, height: number, mask: Uint8Array): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(`${basePixelHash}:${await maskHash(width, height, mask)}`));
}
