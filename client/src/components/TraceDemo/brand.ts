/**
 * Latence brand tokens. Values are the colors observed on
 * https://www.latence.ai (homepage and dashboard CSS).
 *
 * The product surface is dark; warm cream tones are reserved for type
 * and subtle borders. Latence green (#0b8b91) is the only accent.
 */
export const latence = {
  bgPrimary: '#0a0a0a',
  bgSurface: '#0d0d0d',
  bgRaised: '#111111',
  border: 'rgba(216, 210, 198, 0.12)',
  borderStrong: 'rgba(216, 210, 198, 0.22)',
  green: '#0b8b91',
  greenSoft: 'rgba(11, 139, 145, 0.18)',
  greenSoftStrong: 'rgba(11, 139, 145, 0.32)',
  greenText: '#5fc7cc',
  text: '#f4f1eb',
  textMuted: '#bfcfc9',
  textSubtle: '#85827a',
  amber: '#d29a3a',
  amberSoft: 'rgba(210, 154, 58, 0.16)',
  rose: '#c44b3a',
  roseSoft: 'rgba(196, 75, 58, 0.18)',
} as const;

export type LatenceBrand = typeof latence;

export const LATENCE_LOGO_SRC = '/assets/latence-logo.png';
