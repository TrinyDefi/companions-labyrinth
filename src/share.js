/* share.js — share-card builder (1080 x 1350). Created by builder per SPEC 10.2.
 * window.buildShareCard(opts) -> HTMLCanvasElement (1080 x 1350).
 * opts: { layer, characterImg, levelsReached, chestsTotal, score }
 * Uses only CONFIG strings. No network, no dependencies.
 */
(function (root) {
  'use strict';

  var CARD_W = 1080, CARD_H = 1350, MAX_LINE = 1000;
  var FONT_STACK = '"Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

  function font(weight, px) { return weight + ' ' + px + 'px ' + FONT_STACK; }

  // Reduce font size until the line fits maxWidth (no wrap, no clip).
  function fitFont(ctx, text, weight, px, maxWidth) {
    var size = px;
    ctx.font = font(weight, size);
    while (size > 8 && ctx.measureText(text).width > maxWidth) {
      size -= 2;
      ctx.font = font(weight, size);
    }
    return size;
  }

  function centerText(ctx, text, x, y, fill, outline, outlineWidth) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    if (outline && outlineWidth > 0) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = outlineWidth;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function buildShareCard(opts) {
    var C = (typeof window !== 'undefined' && window.CONFIG) ? window.CONFIG : root.CONFIG;
    var card = document.createElement('canvas');
    card.width = CARD_W;
    card.height = CARD_H;
    var ctx = card.getContext('2d');

    // 1. Background: last level's scene.layer, cover.
    var layer = opts.layer;
    var sw = layer.width;
    var sh = layer.width * CARD_H / CARD_W;
    var sx = 0;
    var sy = Math.max(0, (layer.height - sh) / 2);
    ctx.drawImage(layer, sx, sy, sw, sh, 0, 0, CARD_W, CARD_H);

    // 2. Gradient overlay top -> bottom.
    var g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, 'rgba(8,4,15,0.75)');
    g.addColorStop(0.5, 'rgba(8,4,15,0.25)');
    g.addColorStop(1, 'rgba(8,4,15,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // 3. Title.
    fitFont(ctx, C.GAME_TITLE, 900, 78, MAX_LINE);
    centerText(ctx, C.GAME_TITLE, CARD_W / 2, 120, '#ffffff', '#2a1050', 14);

    // 4. Glow behind the character.
    var glow = ctx.createRadialGradient(540, 640, 10, 540, 640, 380);
    glow.addColorStop(0, 'rgba(190,100,255,0.45)');
    glow.addColorStop(1, 'rgba(190,100,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(540 - 380, 640 - 380, 760, 760);

    // 5. Character sprite: height 520, centered x=540, bottom y=880.
    var img = opts.characterImg;
    if (img && img.naturalWidth > 0) {
      var ch = 520;
      var cw = ch * img.naturalWidth / img.naturalHeight;
      ctx.drawImage(img, 540 - cw / 2, 880 - ch, cw, ch);
    }

    // 6. I REACHED.
    fitFont(ctx, 'I REACHED', 800, 44, MAX_LINE);
    centerText(ctx, 'I REACHED', 540, 945, '#d9bfff', null, 0);

    // 7. LEVEL N with gradient fill.
    var levelText = 'LEVEL ' + opts.levelsReached;
    var lvSize = fitFont(ctx, levelText, 900, 150, MAX_LINE);
    var lg = ctx.createLinearGradient(0, 1075 - lvSize, 0, 1075);
    lg.addColorStop(0, '#c06bff');
    lg.addColorStop(1, '#ff5ad1');
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.font = font(900, lvSize);
    ctx.strokeStyle = '#2a1050';
    ctx.lineWidth = 16;
    ctx.strokeText(levelText, 540, 1075);
    ctx.fillStyle = lg;
    ctx.fillText(levelText, 540, 1075);
    ctx.restore();

    // 8. Stats.
    var stats = opts.chestsTotal + ' chests · ' + opts.score + ' pts';
    fitFont(ctx, stats, 800, 52, MAX_LINE);
    centerText(ctx, stats, 540, 1145, '#ffffff', '#2a1050', 8);

    // 9. Fan-made credit.
    var credit = 'Fan-made for ' + C.PROJECT_HANDLE + ' by ' + C.BUILDER_HANDLE;
    fitFont(ctx, credit, 700, 38, MAX_LINE);
    centerText(ctx, credit, 540, 1240, '#d9bfff', null, 0);

    // 10. Disclaimer.
    fitFont(ctx, C.DISCLAIMER, 600, 26, MAX_LINE);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = ctx.font; // keep fitted font
    ctx.fillStyle = 'rgba(217,191,255,0.7)';
    ctx.fillText(C.DISCLAIMER, 540, 1295);
    ctx.restore();

    return card;
  }

  root.buildShareCard = buildShareCard;
})(typeof window !== 'undefined' ? window : globalThis);
