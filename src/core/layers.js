// Render layers. Everything on LAYER_DEFAULT gets an ink outline from the post-process.
// Sky, particles, glows and other things that must not be outlined go on LAYER_NO_OUTLINE only:
//   obj.layers.set(LAYER_NO_OUTLINE)
export const LAYER_DEFAULT = 0;
export const LAYER_NO_OUTLINE = 1;
