// Meet-style layout: every tile keeps the aspect ratio of its own video (a phone's portrait
// camera stays portrait, nothing is cropped) and the tiles take as much of the stage as they can.
// Rows share one height; the row count that gives the largest tiles wins.

export interface FitRow { items: number[]; height: number }

export function fitRows(width: number, height: number, aspects: number[], gap: number): FitRow[] {
  const n = aspects.length;
  if (!n || width <= 0 || height <= 0) return [];
  let best: FitRow[] = [];
  let bestArea = -1;
  for (let rows = 1; rows <= n; rows++) {
    // split in order into `rows` rows of near-equal count
    const split: number[][] = [];
    for (let r = 0, i = 0; r < rows; r++) {
      const k = Math.ceil((n - i) / (rows - r));
      split.push(Array.from({ length: k }, (_, j) => i + j));
      i += k;
    }
    let h = (height - gap * (rows - 1)) / rows;
    for (const row of split) {
      const sum = row.reduce((s, i) => s + aspects[i], 0);
      h = Math.min(h, (width - gap * (row.length - 1)) / sum);
    }
    if (h <= 0) continue;
    const area = h * h * aspects.reduce((s, a) => s + a, 0);
    if (area > bestArea) { bestArea = area; best = split.map((items) => ({ items, height: Math.floor(h) })); }
  }
  return best;
}

/** Aspect ratio of a tile's video; a tile without video (avatar) is 16:9. Clamped to sane values. */
export function aspectOf(dims?: { width: number; height: number } | null): number {
  if (!dims || !dims.width || !dims.height) return 16 / 9;
  return Math.min(2.4, Math.max(0.45, dims.width / dims.height));
}
