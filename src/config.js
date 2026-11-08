/* config.js v2 — PROVIDED. Opus must not change anything in this file. */
window.CONFIG = {
  // ===== OWNER EDITS THESE =====
  BUILDER_HANDLE: '@TrinyDefi',
  // =============================
  PROJECT_HANDLE: '@CompanionsWfit',
  EXTRA_TAGS: ['@WFitApp'],
  GAME_TITLE: 'COMPANION LABYRINTH',
  SUBTITLE: 'Fan-made concept for WFit Companions',
  DISCLAIMER: 'Fan-made · not official · Companion designs belong to WFit Companions',
  STORAGE_KEY: 'companionLabyrinthBest',

  // Fan-concept perks. Official names/abilities are NOT published, so these are labelled fan-made.
  CHARACTERS: [
    { id: 'pink',   label: 'Pink Companion',   img: 'assets/characters/char_pink.png',   perk: 'swift',      perkText: 'Swift: hops 30% faster' },
    { id: 'green',  label: 'Green Companion',  img: 'assets/characters/char_green.png',  perk: 'timekeeper', perkText: 'Time Keeper: +15 s every level' },
    { id: 'blue',   label: 'Blue Companion',   img: 'assets/characters/char_blue.png',   perk: 'chestlover', perkText: 'Chest Lover: chests give +10 s' },
    { id: 'purple', label: 'Purple Companion', img: 'assets/characters/char_purple.png', perk: 'pathfinder', perkText: 'Pathfinder: shows a hint trail when idle' }
  ],

  // Every image the game may load. Keys are used by code; the renderer needs the first six.
  IMAGES: {
    sigil_w:          'assets/props/sigil_w.png',
    pillar:           'assets/props/pillar.png',
    crystal_purple_s: 'assets/props/crystal_purple_s.png',
    crystal_purple_m: 'assets/props/crystal_purple_m.png',
    crystal_blue_s:   'assets/props/crystal_blue_s.png',
    crystal_blue_m:   'assets/props/crystal_blue_m.png',
    chest_closed:     'assets/props/chest_closed.png',
    chest_open:       'assets/props/chest_open.png'
  },

  // Gameplay numbers (see SPEC.md section 6/7). Do not invent others.
  HOP_MS: 170, HOP_MS_SWIFT: 130,
  CHEST_BONUS_S: 5, CHEST_BONUS_S_CHESTLOVER: 10,
  TIMEKEEPER_BONUS_S: 15,
  HINT_IDLE_S: 4, HINT_STEPS: 6,
  LEVEL_CLEAR_MS: 1400,

  // ----- added in UPDATE-A (landscape + traps) -----
  ROTATE_BTN: 'Play in landscape',
  ROTATE_HINT: 'Rotate your phone to play in landscape.',
  TRAP_INTRO: {
    spike: 'Spikes! Time your steps.',
    goo:   'Slime! It slows you down.',
    gate:  'Gates! Wait for them to open.'
  },
  TRAP_INTRO_MS: 2500
};
