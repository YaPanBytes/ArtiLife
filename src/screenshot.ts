/** A file name for a screenshot, from the world's seed and the tick it was taken at. */
export function screenshotName(seed: number, tick: number): string {
  return `artilife-seed${seed}-tick${tick}.png`;
}

/**
 * The game screen as a PNG, enlarged by a whole number with no smoothing so the
 * pixels stay sharp.
 */
export function captureCanvas(source: HTMLCanvasElement, scale = 4): Promise<Blob> {
  const out = document.createElement('canvas');
  out.width = source.width * scale;
  out.height = source.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) =>
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('could not make an image'))),
      'image/png',
    ),
  );
}

/** Offer a blob to the user as a file download. */
export function download(
  blob: Blob | string,
  filename: string,
  type = 'application/octet-stream',
): void {
  const url = URL.createObjectURL(typeof blob === 'string' ? new Blob([blob], { type }) : blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
