/**
 * Built-in color palettes for pixel art and game development.
 */

import type { Palette } from "./palette-registry.js";

export const PICO8: Palette = {
  name: "pico8",
  colors: [
    "#000000",
    "#1D2B53",
    "#7E2553",
    "#008751",
    "#AB5236",
    "#5F574F",
    "#C2C3C7",
    "#FFF1E8",
    "#FF004D",
    "#FFA300",
    "#FFEC27",
    "#00E436",
    "#29ADFF",
    "#83769C",
    "#FF77A8",
    "#FFCCAA",
  ],
};

export const ENDESGA32: Palette = {
  name: "endesga32",
  colors: [
    "#BE4A2F",
    "#D77643",
    "#EAD4AA",
    "#E4A672",
    "#B86F50",
    "#733E39",
    "#3E2731",
    "#A22633",
    "#E43B44",
    "#F77622",
    "#FEAE34",
    "#FEE761",
    "#63C74D",
    "#3E8948",
    "#265C42",
    "#193C3E",
    "#124E89",
    "#0099DB",
    "#2CE8F5",
    "#FFFFFF",
    "#C0CBDC",
    "#8B9BB4",
    "#5A6988",
    "#3A4466",
    "#262B44",
    "#181425",
    "#FF0044",
    "#68386C",
    "#B55088",
    "#F6757A",
    "#E8B796",
    "#C28569",
  ],
};

export const RESURRECT64: Palette = {
  name: "resurrect64",
  colors: [
    "#2E222F",
    "#3E3546",
    "#625565",
    "#966C6C",
    "#AB947A",
    "#694F62",
    "#7F708A",
    "#9BABB2",
    "#C7DCD0",
    "#FFFFFF",
    "#6E2727",
    "#B33831",
    "#EA4F36",
    "#F57D4A",
    "#AE2334",
    "#E83B3B",
  ],
};

export const SHIPPED_PALETTES: Palette[] = [PICO8, ENDESGA32, RESURRECT64];
