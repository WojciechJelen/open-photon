/** Seconds as a monitor's timecode: `00:02.8` (minutes, seconds and tenths). */
export function timecode(seconds: number) {
  const tenths = Math.max(0, Math.floor(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;

  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** Milliseconds as a short duration: `5.0 s`. */
export function duration(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}
