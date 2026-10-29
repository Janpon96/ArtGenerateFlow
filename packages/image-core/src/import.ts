export interface ImportLimits {
  maxReferences: number;
  maxFileBytes: number;
  maxMegapixels: number;
}

export const LOCAL_LIMITS: Readonly<ImportLimits> = {
  maxReferences: 24,
  maxFileBytes: 20 * 1024 * 1024,
  maxMegapixels: 24,
};

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageProbe {
  mimeType: ImageMime;
  width: number;
  height: number;
}

export class ImportRejected extends Error {
  constructor(public readonly code:
    | 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'SVG_NOT_ALLOWED' | 'ANIMATED'
    | 'CORRUPT' | 'TOO_MANY_PIXELS', message: string) {
    super(message);
  }
}

const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

function looksLikeSvg(b: Uint8Array): boolean {
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || head.includes('<svg');
}

function probePng(b: Uint8Array): ImageProbe {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR') throw new ImportRejected('CORRUPT', 'PNG header is damaged.');
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  // Walk chunks: acTL means APNG; IEND must exist.
  let o = 8;
  let sawEnd = false;
  while (o + 8 <= b.length) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    if (type === 'acTL') throw new ImportRejected('ANIMATED', 'Animated PNG is not supported. Export a single frame.');
    if (type === 'IEND') { sawEnd = true; break; }
    o += 12 + len;
  }
  if (!sawEnd) throw new ImportRejected('CORRUPT', 'PNG is truncated (no IEND chunk).');
  return { mimeType: 'image/png', width, height };
}

function probeJpeg(b: Uint8Array): ImageProbe {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) throw new ImportRejected('CORRUPT', 'JPEG marker stream is damaged.');
    const marker = b[o + 1]!;
    if (marker === 0xff) { o++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue; }
    const len = (b[o + 2]! << 8) | b[o + 3]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 9 > b.length) break;
      return { mimeType: 'image/jpeg', height: (b[o + 5]! << 8) | b[o + 6]!, width: (b[o + 7]! << 8) | b[o + 8]! };
    }
    o += 2 + len;
  }
  throw new ImportRejected('CORRUPT', 'JPEG has no readable frame header.');
}

function probeWebp(b: Uint8Array): ImageProbe {
  if (b.length < 30) throw new ImportRejected('CORRUPT', 'WebP is too short.');
  const kind = ascii(b, 12, 4);
  const le24 = (o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
  if (kind === 'VP8X') {
    if (b[20]! & 0x02) throw new ImportRejected('ANIMATED', 'Animated WebP is not supported. Export a single frame.');
    return { mimeType: 'image/webp', width: le24(24) + 1, height: le24(27) + 1 };
  }
  if (kind === 'VP8 ') {
    return { mimeType: 'image/webp', width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  if (kind === 'VP8L') {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new ImportRejected('CORRUPT', 'WebP has an unknown chunk layout.');
}

/**
 * Identifies the file from its bytes, never from the name or declared MIME type.
 * Throws ImportRejected with a user-facing message.
 */
export function probeImage(bytes: Uint8Array, limits: Readonly<ImportLimits> = LOCAL_LIMITS): ImageProbe {
  if (bytes.length === 0) throw new ImportRejected('EMPTY', 'The file is empty.');
  if (bytes.length > limits.maxFileBytes) {
    throw new ImportRejected('TOO_LARGE', `File is larger than ${limits.maxFileBytes / 1024 / 1024} MiB.`);
  }
  let probe: ImageProbe;
  if (bytes.length >= 8 && u32be(bytes, 0) === 0x89504e47 && u32be(bytes, 4) === 0x0d0a1a0a) probe = probePng(bytes);
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) probe = probeJpeg(bytes);
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') probe = probeWebp(bytes);
  else if (looksLikeSvg(bytes)) throw new ImportRejected('SVG_NOT_ALLOWED', 'SVG is not allowed because it can contain scripts.');
  else throw new ImportRejected('UNSUPPORTED_TYPE', 'Only PNG, JPEG and WebP are supported.');

  if (probe.width < 1 || probe.height < 1) throw new ImportRejected('CORRUPT', 'Image has zero size.');
  if ((probe.width * probe.height) / 1e6 > limits.maxMegapixels) {
    throw new ImportRejected('TOO_MANY_PIXELS', `Image is larger than ${limits.maxMegapixels} megapixels.`);
  }
  return probe;
}

/** Pixel hash over straight RGBA8 bytes, prefixed with dimensions so equal bytes of different shapes differ. */
export async function pixelHash(width: number, height: number, rgba: Uint8Array): Promise<string> {
  if (rgba.length !== width * height * 4) throw new ImportRejected('CORRUPT', 'Pixel buffer does not match dimensions.');
  const head = new TextEncoder().encode(`rgba8:${width}x${height}:`);
  const all = new Uint8Array(head.length + rgba.length);
  all.set(head, 0);
  all.set(rgba, head.length);
  const d = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Returns the existing id when the same bytes were imported already, so the user is told instead of getting a silent duplicate. */
export function findDuplicate(byteHash: string, known: ReadonlyMap<string, string>): string | null {
  return known.get(byteHash) ?? null;
}
