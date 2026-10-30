import { describe, it, expect } from 'vitest';
import { packSpritesheet, type InputFrame } from '@frs/image-core';

function makeSolidFrame(w: number, h: number, r: number, g: number, b: number): InputFrame {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return { width: w, height: h, rgba };
}

describe('packSpritesheet', () => {
  it('handles empty frames list gracefully', () => {
    const res = packSpritesheet([]);
    expect(res.width).toBe(1);
    expect(res.height).toBe(1);
    expect(res.meta.frames).toHaveLength(0);
  });

  it('packs 4 frames into a 2x2 grid by default', () => {
    const frames = [
      makeSolidFrame(10, 10, 255, 0, 0),
      makeSolidFrame(10, 10, 0, 255, 0),
      makeSolidFrame(10, 10, 0, 0, 255),
      makeSolidFrame(10, 10, 255, 255, 0),
    ];

    const res = packSpritesheet(frames);
    expect(res.width).toBe(20);
    expect(res.height).toBe(20);
    expect(res.meta.meta.columns).toBe(2);
    expect(res.meta.meta.rows).toBe(2);
    expect(res.meta.frames).toHaveLength(4);

    // Frame 0 top-left (0,0) -> Red
    expect(res.rgba[0]).toBe(255);
    expect(res.rgba[1]).toBe(0);

    // Frame 1 top-right (10,0) -> Green
    const f1Start = 10 * 4;
    expect(res.rgba[f1Start]).toBe(0);
    expect(res.rgba[f1Start + 1]).toBe(255);

    // Frame 2 bottom-left (0,10) -> Blue
    const f2Start = 10 * 20 * 4;
    expect(res.rgba[f2Start]).toBe(0);
    expect(res.rgba[f2Start + 2]).toBe(255);
  });

  it('respects custom column parameter', () => {
    const frames = [
      makeSolidFrame(8, 8, 1, 1, 1),
      makeSolidFrame(8, 8, 2, 2, 2),
      makeSolidFrame(8, 8, 3, 3, 3),
    ];
    const res = packSpritesheet(frames, 3);
    expect(res.width).toBe(24);
    expect(res.height).toBe(8);
    expect(res.meta.meta.columns).toBe(3);
    expect(res.meta.meta.rows).toBe(1);
  });
});
