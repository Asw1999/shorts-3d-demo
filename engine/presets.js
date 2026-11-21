/**
 * Generic visual, camera, tempo, and narration-chunk variation presets.
 * Selectable per video via PRESET=explainer|cinematic|punchy (env / URL query / workflow input).
 */
export const PRESETS = {
  explainer: {
    name: 'explainer',
    label: 'Crisp Explainer (Default)',
    camera: {
      segDur: 2.7,
      orbitAmp: 1.0,
      zoomAmp: 1.0,
      elevBias: 0.0,
      targetHeightFrac: 0.388,
    },
    palette: {
      accentHex: '#ffd43b',
      rimHex: '#e2f9ff',
      captionBg: 'rgba(12, 15, 23, 0.44)',
      hookBorder: '#ffd43b',
      litBoost: 1.0,
      shadowDepth: 1.0,
    },
    tempo: {
      hookDur: 2.15,
      captionPopScale: 0.04,
      wordLiftPx: 4.0,
    },
    narration: {
      chunkMaxWords: 7,
      preferShortHookChunks: false,
    },
  },

  cinematic: {
    name: 'cinematic',
    label: 'Cinematic Dramatic',
    camera: {
      segDur: 2.85,
      orbitAmp: 1.35,
      zoomAmp: 1.22,
      elevBias: -0.35,
      targetHeightFrac: 0.402,
    },
    palette: {
      accentHex: '#ff9f43',
      rimHex: '#a5f3fc',
      captionBg: 'rgba(6, 10, 18, 0.62)',
      hookBorder: '#ff9f43',
      litBoost: 1.04,
      shadowDepth: 0.90,
    },
    tempo: {
      hookDur: 2.35,
      captionPopScale: 0.025,
      wordLiftPx: 2.5,
    },
    narration: {
      chunkMaxWords: 6,
      preferShortHookChunks: false,
    },
  },

  punchy: {
    name: 'punchy',
    label: 'Punchy Fast-Cut Shorts',
    camera: {
      segDur: 2.15,
      orbitAmp: 1.18,
      zoomAmp: 1.32,
      elevBias: 0.22,
      targetHeightFrac: 0.394,
    },
    palette: {
      accentHex: '#38ef7d',
      rimHex: '#ffffff',
      captionBg: 'rgba(10, 12, 20, 0.54)',
      hookBorder: '#38ef7d',
      litBoost: 1.06,
      shadowDepth: 1.04,
    },
    tempo: {
      hookDur: 1.95,
      captionPopScale: 0.06,
      wordLiftPx: 5.5,
    },
    narration: {
      chunkMaxWords: 4,
      preferShortHookChunks: true,
    },
  },
};

export function resolvePreset(name) {
  const key = String(name || 'explainer').trim().toLowerCase();
  return PRESETS[key] || PRESETS.explainer;
}
