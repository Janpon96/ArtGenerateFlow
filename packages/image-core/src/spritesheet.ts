export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpritesheetMeta {
  app: string;
  version: string;
  image: string;
  format: string;
  size: { w: number; h: number };
  scale: number;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

export interface SpritesheetFrameEntry {
  index: number;
  filename: string;
  frame: FrameRect;
  sourceSize: { w: number; h: number };
}

export interface SpritesheetPackResult {
  width: number;
  height: number;
  rgba: Uint8Array;
  meta: {
    meta: SpritesheetMeta;
    frames: SpritesheetFrameEntry[];
  };
}

export interface InputFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Đóng gói danh sách frame RGBA thành 1 Spritesheet RGBA dạng lưới kèm metadata JSON.
 */
export function packSpritesheet(frames: InputFrame[], cols: number = 0): SpritesheetPackResult {
  const n = frames.length;
  if (n === 0) {
    return {
      width: 1,
      height: 1,
      rgba: new Uint8Array(4),
      meta: {
        meta: {
          app: 'Flow Reference Studio',
          version: '1.0',
          image: 'spritesheet.png',
          format: 'RGBA8888',
          size: { w: 1, h: 1 },
          scale: 1,
          frameCount: 0,
          frameWidth: 0,
          frameHeight: 0,
          columns: 0,
          rows: 0,
        },
        frames: [],
      },
    };
  }

  const fw = frames[0]!.width;
  const fh = frames[0]!.height;

  let columns = cols <= 0 ? Math.ceil(Math.sqrt(n)) : cols;
  columns = Math.max(1, Math.min(columns, n));
  const rows = Math.ceil(n / columns);

  const sheetW = columns * fw;
  const sheetH = rows * fh;
  const sheetRgba = new Uint8Array(sheetW * sheetH * 4);

  const entries: SpritesheetFrameEntry[] = [];

  for (let idx = 0; idx < n; idx++) {
    const frame = frames[idx]!;
    const c = idx % columns;
    const r = Math.floor(idx / columns);
    const startX = c * fw;
    const startY = r * fh;

    // Sao chép từng hàng pixel của frame vào sheet
    const src = frame.rgba;
    for (let row = 0; row < fh; row++) {
      const srcOffset = row * fw * 4;
      const dstOffset = ((startY + row) * sheetW + startX) * 4;
      sheetRgba.set(src.subarray(srcOffset, srcOffset + fw * 4), dstOffset);
    }

    entries.push({
      index: idx,
      filename: `frame_${String(idx).padStart(3, '0')}.png`,
      frame: { x: startX, y: startY, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
    });
  }

  return {
    width: sheetW,
    height: sheetH,
    rgba: sheetRgba,
    meta: {
      meta: {
        app: 'Flow Reference Studio',
        version: '1.0',
        image: 'spritesheet.png',
        format: 'RGBA8888',
        size: { w: sheetW, h: sheetH },
        scale: 1,
        frameCount: n,
        frameWidth: fw,
        frameHeight: fh,
        columns,
        rows,
      },
      frames: entries,
    },
  };
}
