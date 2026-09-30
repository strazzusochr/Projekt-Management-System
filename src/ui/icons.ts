/**
 * Inline SVG icon set for the Riverbound UI (24x24 grid, stroke based, currentColor).
 * Icons are returned as strings so they can be dropped into innerHTML without any extra request.
 */
export type IconName =
  | 'bulb'
  | 'undo'
  | 'reset'
  | 'pause'
  | 'settings'
  | 'boat'
  | 'arrow'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'x'
  | 'alert'
  | 'info'
  | 'lock'
  | 'unlock'
  | 'star'
  | 'clock'
  | 'scale'
  | 'users'
  | 'flag'
  | 'book'
  | 'volume'
  | 'mute'
  | 'map'
  | 'play'
  | 'target'
  | 'trophy'
  | 'sparkle'
  | 'compass'
  | 'monitor'
  | 'motion'
  | 'anchor'
  | 'exit'
  | 'skip'
  | 'dot';

const PATHS: Record<IconName, string> = {
  bulb: '<path d="M9 18h6"/><path d="M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.6.5.9 1.1.9 1.8v.5h6V16c0-.7.3-1.3.9-1.8A6.5 6.5 0 0 0 12 2.5z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  reset: '<path d="M3 12a9 9 0 1 0 2.7-6.4L3 8.3"/><path d="M3 3.5v5h5"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>',
  settings:
    '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 17h9"/><path d="M17 17h3"/><circle cx="15" cy="17" r="2"/>',
  boat: '<path d="M2.5 15.5h19l-2.6 4.2a1.5 1.5 0 0 1-1.3.8H6.4a1.5 1.5 0 0 1-1.3-.8z"/><path d="M12 3v12.5"/><path d="M12 4.5c3.4 1.6 5.6 5.2 5.6 9H12"/><path d="M12 7.5c-2.6 1.4-4.4 3.8-4.6 6H12"/>',
  arrow: '<path d="M3.5 12h16"/><path d="m13.5 6 6 6-6 6"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-down': '<path d="m5 9 7 7 7-7"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.2 2.6 19.6a1 1 0 0 0 .9 1.5h17a1 1 0 0 0 .9-1.5z"/><path d="M12 9.5v5"/><path d="M12 17.6v.1"/>',
  info: '<circle cx="12" cy="12" r="9.2"/><path d="M12 11v5.5"/><path d="M12 7.6v.1"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
  star: '<path d="M12 2.8l2.85 5.95 6.5.9-4.75 4.55 1.2 6.45L12 17.4l-5.8 3.25 1.2-6.45L2.65 9.65l6.5-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9.2"/><path d="M12 6.5V12l3.6 2.2"/>',
  scale: '<path d="M12 3.5v17"/><path d="M6.5 20.5h11"/><path d="M4 7.5h16"/><path d="M4 7.5 2 13.5a3 3 0 0 0 4 0z"/><path d="M20 7.5l-2 6a3 3 0 0 0 4 0z"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M17.5 14.2a5 5 0 0 1 4.6 5.3"/>',
  flag: '<path d="M5 21V3.5"/><path d="M5 4.5c4-2 6.5 2 10.5 0 1.5-.7 3-.7 4.5 0v9c-1.5-.7-3-.7-4.5 0-4 2-6.5-2-10.5 0"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>',
  volume: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.3 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  trophy: '<path d="M7.5 3.5h9v6a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5.5h-3a3 3 0 0 0 3 4.5"/><path d="M16.5 5.5h3a3 3 0 0 1-3 4.5"/><path d="M12 14v4"/><path d="M8.5 20.5h7"/>',
  sparkle: '<path d="M11 3.5l1.9 5.6 5.6 1.9-5.6 1.9L11 18.5l-1.9-5.6L3.5 11l5.6-1.9z"/><path d="M19 3v4M17 5h4"/>',
  compass: '<circle cx="12" cy="12" r="9.2"/><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  motion: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  anchor: '<circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21"/><path d="M6 12H4a8 8 0 0 0 16 0h-2"/><path d="M8.5 11h7"/>',
  exit: '<path d="M14 4.5h4.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M4 12h11"/><path d="m8.5 7.5-4.5 4.5 4.5 4.5"/>',
  skip: '<path d="m6 5.5 7 6.5-7 6.5z"/><path d="m13 5.5 7 6.5-7 6.5z"/>',
  dot: '<circle cx="12" cy="12" r="3.2"/>',
};

/** Returns an inline `<svg>` string for the icon. Stars are filled through CSS (`fill: currentColor`). */
export function icon(name: IconName, cls = ''): string {
  return `<svg class="rb-svg ${cls}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Riverbound emblem: ring, waves and a sailboat. Colours come from `currentColor` so themes can tint it. */
export function logoMark(size = 64): string {
  return `<svg class="rb-logomark" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="29.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
  <circle cx="32" cy="32" r="25" fill="currentColor" fill-opacity=".07" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>
  <path d="M32 13.5v24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M33.6 15c8 3.4 12.4 10.6 12.4 20.2H33.6z" fill="currentColor"/>
  <path d="M30.6 19.5c-6 3.2-9.6 8.6-9.8 15.7h9.8z" fill="currentColor" fill-opacity=".62"/>
  <path d="M17.5 38.5h29l-3.8 6.4a2.4 2.4 0 0 1-2 1.1H23.3a2.4 2.4 0 0 1-2-1.1z" fill="currentColor"/>
  <path d="M12 51c3.2 0 3.2-2.4 6.4-2.4s3.2 2.4 6.4 2.4 3.2-2.4 6.4-2.4 3.2 2.4 6.4 2.4 3.2-2.4 6.4-2.4 3.2 2.4 6.4 2.4" fill="none" stroke="currentColor" stroke-opacity=".8" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;
}

/** Decorative wave band used on the boot screen. */
export function wavesSvg(): string {
  return `<svg viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
  <path class="rb-wave rb-wave--a" d="M0 60c100 0 100-30 200-30s100 30 200 30 100-30 200-30 100 30 200 30 100-30 200-30 100 30 200 30v60H0z"/>
  <path class="rb-wave rb-wave--b" d="M0 80c100 0 100-26 200-26s100 26 200 26 100-26 200-26 100 26 200 26 100-26 200-26 100 26 200 26v40H0z"/>
</svg>`;
}
