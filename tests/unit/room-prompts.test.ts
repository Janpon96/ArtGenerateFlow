import { describe, it, expect } from 'vitest';
import { buildRoomPrompts, MAX_ROOM_VIEWS, parseObjects, ROOM_VIEW_PRESETS } from '../../apps/extension/src/room-prompts';

const opts = (over: Partial<Parameters<typeof buildRoomPrompts>[0]> = {}) => ({
  viewIds: ['corner', 'left-wall'], objects: [], artStyle: 'anime style', notes: '', ...over,
});

describe('BG Room prompts', () => {
  it('makes one prompt per selected view, in preset order', () => {
    const out = buildRoomPrompts(opts({ viewIds: ['left-wall', 'corner'] }));
    expect(out.map((p) => p.label)).toEqual(['Góc phòng chính', 'Tường trái']);
  });

  it('asks for an eye-level view from the room centre and rules out isometric output', () => {
    const [p] = buildRoomPrompts(opts({ viewIds: ['corner'] }));
    expect(p!.prompt).toContain('standing in the center of the room');
    expect(p!.prompt).toContain('NOT be isometric');
    expect(p!.prompt).toContain('no characters');
    expect(p!.prompt).toContain('ART STYLE: anime style.');
    expect(p!.prompt).not.toContain('\n');
  });

  it('adds one close-up per object after the views', () => {
    const out = buildRoomPrompts(opts({ objects: ['giường', 'bàn học'] }));
    expect(out.map((p) => p.label)).toEqual(['Góc phòng chính', 'Tường trái', 'Vật thể: giường', 'Vật thể: bàn học']);
    expect(out[2]!.prompt).toContain('the "giường" from the isometric image');
  });

  it('includes notes only when given and caps the total', () => {
    expect(buildRoomPrompts(opts())[0]!.prompt).not.toContain('EXTRA NOTES');
    expect(buildRoomPrompts(opts({ notes: 'buổi chiều' }))[0]!.prompt).toContain('EXTRA NOTES: buổi chiều.');
    const many = buildRoomPrompts(opts({
      viewIds: ROOM_VIEW_PRESETS.map((v) => v.id), objects: ['a', 'b', 'c', 'd', 'e'],
    }));
    expect(many).toHaveLength(MAX_ROOM_VIEWS);
  });

  it('returns nothing when no view and no object is chosen', () => {
    expect(buildRoomPrompts(opts({ viewIds: [] }))).toEqual([]);
  });

  it('parses the object list, dropping blanks and duplicates', () => {
    expect(parseObjects(' giường, bàn  học ;Giường,\n, kệ sách')).toEqual(['giường', 'bàn học', 'kệ sách']);
  });
});
