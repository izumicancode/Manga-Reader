/** Converts #rrggbb into the "H S% L%" triplet shadcn's CSS variables expect. */
export function hexToHslTriplet(hex: string): { hsl: string; foreground: string } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  // Perceived luminance decides whether text on the accent is white or near-black.
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return {
    hsl: `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`,
    foreground: lum > 0.62 ? '216 29% 8%' : '0 0% 100%'
  }
}
