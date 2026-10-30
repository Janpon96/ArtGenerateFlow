export interface LoopMetricsResult {
  loopScore: number;
  stepMean: number;
  loopGap: number;
  seamless: boolean;
}

/**
 * Tính Mean Squared Error (MSE) giữa 2 buffer RGBA.
 */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  const len = a.length;
  // Lấy mẫu để tính nhanh nếu ảnh lớn
  const step = len > 100000 ? 4 : 1;
  let count = 0;
  for (let i = 0; i < len; i += step) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
    count++;
  }
  return sum / count;
}

/**
 * Đánh giá độ mượt của animation lặp:
 * So sánh bước nhảy giữa các frame liên tiếp và giữa frame cuối về frame đầu.
 */
export function calculateLoopMetrics(frames: Array<{ rgba: Uint8Array }>): LoopMetricsResult {
  if (frames.length < 2) {
    return { loopScore: 1, stepMean: 0, loopGap: 0, seamless: true };
  }

  const stepDiffs: number[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    stepDiffs.push(frameDiff(frames[i]!.rgba, frames[i + 1]!.rgba));
  }

  const sum = stepDiffs.reduce((acc, v) => acc + v, 0);
  const stepMean = sum / stepDiffs.length || 1;
  const loopGap = frameDiff(frames[frames.length - 1]!.rgba, frames[0]!.rgba);

  const ratio = loopGap / (stepMean + 1e-6);
  let score = ratio > 1 ? 1 - (ratio - 1) * 0.3 : 1;
  score = Math.max(0, Math.min(1, score));

  return {
    loopScore: Math.round(score * 1000) / 1000,
    stepMean: Math.round(stepMean * 100) / 100,
    loopGap: Math.round(loopGap * 100) / 100,
    seamless: ratio <= 1.5,
  };
}
