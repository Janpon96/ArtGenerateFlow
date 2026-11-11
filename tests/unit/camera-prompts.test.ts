import { describe, it, expect } from 'vitest';
import {
  aspectForImage, buildCameraPrompts, CAMERA_OPTIONS, MAX_CAMERA_SHOTS, parseCustomCameras,
} from '../../apps/extension/src/camera-prompts';

const opts = (over: Partial<Parameters<typeof buildCameraPrompts>[0]> = {}) => ({
  optionIds: ['low'], custom: [], artStyle: 'anime style', notes: '', keepPose: true, ...over,
});

describe('Camera Image prompts', () => {
  it('has unique option ids', () => {
    expect(new Set(CAMERA_OPTIONS.map((o) => o.id)).size).toBe(CAMERA_OPTIONS.length);
  });

  it('makes one prompt per selected option, in list order', () => {
    const out = buildCameraPrompts(opts({ optionIds: ['mcu', 'low'] }));
    expect(out.map((p) => p.label)).toEqual(['Góc thấp (từ dưới lên)', 'Trung cận (medium close-up)']);
  });

  it('keeps the scene and forbids returning a crop of the source', () => {
    const [p] = buildCameraPrompts(opts());
    expect(p!.prompt).toContain('NEW CAMERA: low-angle shot');
    expect(p!.prompt).toContain('SAME scene');
    expect(p!.prompt).toContain('Do not return a crop');
    expect(p!.prompt).toContain('ART STYLE: anime style.');
    expect(p!.prompt).not.toContain('\n');
  });

  it('switches the pose rule with keepPose', () => {
    expect(buildCameraPrompts(opts())[0]!.prompt).toContain('exactly the same pose');
    expect(buildCameraPrompts(opts({ keepPose: false }))[0]!.prompt).toContain('small natural adjustments');
  });

  it('adds custom cameras after the presets and caps the total', () => {
    const out = buildCameraPrompts(opts({ custom: ['góc thấp, cận mặt'] }));
    expect(out[1]!.label).toBe('Tùy chỉnh: góc thấp, cận mặt');
    expect(out[1]!.prompt).toContain('NEW CAMERA: góc thấp, cận mặt.');
    const many = buildCameraPrompts(opts({ optionIds: CAMERA_OPTIONS.map((o) => o.id) }));
    expect(many).toHaveLength(MAX_CAMERA_SHOTS);
  });

  it('returns nothing when nothing is chosen', () => {
    expect(buildCameraPrompts(opts({ optionIds: [] }))).toEqual([]);
  });

  it('splits custom cameras by line or semicolon and keeps commas', () => {
    expect(parseCustomCameras('góc thấp, cận mặt\n\n từ trên  cao ; Góc thấp, cận mặt')).toEqual(['góc thấp, cận mặt', 'từ trên cao']);
  });

  it('picks the Flow aspect closest to the source image', () => {
    expect(aspectForImage(1920, 1080)).toBe('16:9');
    expect(aspectForImage(768, 1376)).toBe('9:16');
    expect(aspectForImage(1024, 1000)).toBe('1:1');
    expect(aspectForImage(0, 0)).toBe('16:9');
  });
});
