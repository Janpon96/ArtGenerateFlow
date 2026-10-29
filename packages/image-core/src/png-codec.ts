import type { PngCodec } from './strict';

/**
 * Lossless PNG codec built on web-standard streams (browser, service worker and Node 18+).
 * It does not use canvas: canvas stores premultiplied alpha and would destroy the RGB
 * values hidden under alpha 0, which Strict must keep byte for byte.
 * Supported: 8-bit, colour type 2 (RGB) or 6 (RGBA), no interlace. Anything else throws.
 */
export const WEB_PNG_CODEC_VERSION = 'frs-web-png/1.0.0';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class UnsupportedPngError extends Error {}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export const webPngCodec: PngCodec = {
  encoderVersion: WEB_PNG_CODEC_VERSION,
  decoderVersion: WEB_PNG_CODEC_VERSION,

  async encode(width, height, rgba) {
    if (rgba.length !== width * height * 4) throw new UnsupportedPngError('RGBA length does not match the size.');
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height); // filter type 0 on every row
    for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    const idat = await through(raw, new CompressionStream('deflate'));
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA, deflate, adaptive filter, no interlace
    const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  },

  async decode(bytes) {
    if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new UnsupportedPngError('Not a PNG file.');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0, height = 0, colorType = -1;
    const idat: Uint8Array[] = [];
    let pos = 8;
    let sawEnd = false;
    while (pos + 12 <= bytes.length) {
      const len = dv.getUint32(pos);
      const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
      if (pos + 12 + len > bytes.length) throw new UnsupportedPngError('Truncated PNG chunk.');
      const data = bytes.subarray(pos + 8, pos + 8 + len);
      if (dv.getUint32(pos + 8 + len) !== crc32(bytes.subarray(pos + 4, pos + 8 + len))) {
        throw new UnsupportedPngError(`Bad CRC in ${type} chunk.`);
      }
      if (type === 'IHDR') {
        width = new DataView(data.buffer, data.byteOffset).getUint32(0);
        height = new DataView(data.buffer, data.byteOffset).getUint32(4);
        colorType = data[9]!;
        if (data[8] !== 8) throw new UnsupportedPngError(`Bit depth ${data[8]} is not supported (8-bit only).`);
        if (colorType !== 2 && colorType !== 6) throw new UnsupportedPngError(`PNG colour type ${colorType} is not supported.`);
        if (data[12] !== 0) throw new UnsupportedPngError('Interlaced PNG is not supported.');
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') { sawEnd = true; break; }
      pos += 12 + len;
    }
    if (!sawEnd || width === 0 || height === 0) throw new UnsupportedPngError('Incomplete PNG.');

    const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of idat) { joined.set(p, o); o += p.length; }
    const raw = await through(joined, new DecompressionStream('deflate'));

    const bpp = colorType === 6 ? 4 : 3;
    const rowLen = width * bpp;
    if (raw.length !== (rowLen + 1) * height) throw new UnsupportedPngError('Unexpected decompressed size.');
    const cur = new Uint8Array(rowLen);
    let prev = new Uint8Array(rowLen);
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const base = y * (rowLen + 1);
      const ft = raw[base]!;
      for (let i = 0; i < rowLen; i++) {
        const x = raw[base + 1 + i]!;
        const a = i >= bpp ? cur[i - bpp]! : 0;
        const b = prev[i]!;
        const c = i >= bpp ? prev[i - bpp]! : 0;
        let v: number;
        switch (ft) {
          case 0: v = x; break;
          case 1: v = x + a; break;
          case 2: v = x + b; break;
          case 3: v = x + ((a + b) >> 1); break;
          case 4: v = x + paeth(a, b, c); break;
          default: throw new UnsupportedPngError(`Unknown PNG filter ${ft}.`);
        }
        cur[i] = v & 255;
      }
      for (let px = 0; px < width; px++) {
        const d = (y * width + px) * 4, s = px * bpp;
        rgba[d] = cur[s]!; rgba[d + 1] = cur[s + 1]!; rgba[d + 2] = cur[s + 2]!;
        rgba[d + 3] = bpp === 4 ? cur[s + 3]! : 255;
      }
      prev = Uint8Array.from(cur);
    }
    return { width, height, rgba };
  },
};
