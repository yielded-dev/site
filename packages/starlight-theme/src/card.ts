import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { Resvg } from "@resvg/resvg-js";
import satori, { type Font } from "satori";

import type { Library } from "./libraries.ts";

/** Link preview text, read from a built page's Open Graph tags. */
export interface Card {
  readonly title: string;
  readonly description: string | undefined;
  /** The sidebar group shown above the title. */
  readonly section: string | undefined;
}

const width = 1200;
const height = 630;

// Dark palette from tokens.css. Cards render at build time, outside any stylesheet.
const color = {
  bg: "#121310",
  text: "#f3f1e8",
  muted: "#b3b5aa",
  faint: "#7d8076",
  grid: "rgba(243, 241, 232, 0.045)",
};

const require = createRequire(import.meta.url);
const fontFile = (file: string) => readFileSync(require.resolve(`@fontsource/${file}`));
const asset = (file: string) => readFileSync(new URL(`../assets/${file}`, import.meta.url));

// Satori reads WOFF but not WOFF2, which rules out the variable Plex Sans the site uses.
const fonts: Array<Font> = [
  {
    name: "Plex Sans",
    weight: 400,
    style: "normal",
    data: fontFile("ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff"),
  },
  {
    name: "Plex Sans",
    weight: 600,
    style: "normal",
    data: fontFile("ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff"),
  },
  {
    name: "Plex Mono",
    weight: 400,
    style: "normal",
    data: fontFile("ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff"),
  },
];

type Style = Readonly<Record<string, string | number>>;
type Child = Element | string | false | undefined;

interface Element {
  readonly type: string;
  readonly props: {
    readonly style?: Style;
    readonly src?: string;
    readonly children?: Child | ReadonlyArray<Child>;
  };
}

// Satori lays out every element as flex unless told otherwise, and counts an array as several
// children, which a block element (needed for lineClamp) rejects.
const div = (style: Style, ...children: ReadonlyArray<Child>): Element => ({
  type: "div",
  props: {
    style: { display: "flex", ...style },
    children: children.length === 1 ? children[0] : children,
  },
});

const svg = (style: Style, markup: string): Element => ({
  type: "img",
  props: { style, src: `data:image/svg+xml,${encodeURIComponent(markup)}` },
});

/** The brand repository's outlined artwork in `fill`, with its width-to-height ratio. */
const art = (file: string, fill: string) => {
  const markup = asset(file).toString("utf8").replaceAll("currentColor", fill);
  const [, width = "1", height = "1"] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(markup) ?? [];

  return { markup, ratio: Number(width) / Number(height) };
};

const fontSize = 34;
const wordmark = art("wordmark.svg", color.text);
// Wordmark.astro's proportions: 1.133em tall with its baseline 0.312em above the bottom.
const wordmarkHeight = fontSize * 1.133;

const header = (library: Library | undefined) =>
  div(
    { alignItems: "center", fontSize, fontWeight: 600, letterSpacing: "-0.03em" },
    svg(
      {
        width: wordmarkHeight * wordmark.ratio,
        height: wordmarkHeight,
        marginBottom: fontSize * -0.312,
      },
      wordmark.markup,
    ),
    library !== undefined &&
      div({ margin: "0 18px", color: color.faint, fontWeight: 400, fontSize: 38 }, "/"),
    library !== undefined &&
      div({
        width: 15,
        height: 15,
        marginRight: 14,
        borderRadius: 999,
        backgroundColor: library.accent.dark,
        // `38` is the 22% ring alpha the header switcher uses.
        boxShadow: `0 0 0 5px ${library.accent.dark}38`,
      }),
    library !== undefined && div({}, library.name),
  );

/** The mark at display size, in the library's accent or in paper for the site. */
const backdrop = (library: Library | undefined) => {
  const mark = art("mark.svg", library?.accent.dark ?? color.text);
  const height = 470;

  return svg(
    { position: "absolute", top: 96, right: -24, width: height * mark.ratio, height },
    mark.markup,
  );
};

const layout = (card: Card, library: Library | undefined) =>
  div(
    {
      position: "relative",
      width,
      height,
      backgroundColor: color.bg,
      color: color.text,
      fontFamily: "Plex Sans",
    },
    div({
      position: "absolute",
      top: 0,
      left: 0,
      width,
      height,
      backgroundImage: `linear-gradient(${color.grid} 1px, transparent 1px), linear-gradient(90deg, ${color.grid} 1px, transparent 1px)`,
      backgroundSize: "48px 48px",
    }),
    div({
      position: "absolute",
      top: 0,
      left: 0,
      width,
      height,
      backgroundImage: `linear-gradient(to bottom, transparent 35%, ${color.bg} 85%)`,
    }),
    backdrop(library),
    div(
      {
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        padding: "64px 72px 72px",
      },
      header(library),
      div(
        { flexDirection: "column", maxWidth: 820 },
        card.section !== undefined &&
          div(
            {
              marginBottom: 22,
              color: library?.accent.dark ?? color.muted,
              fontFamily: "Plex Mono",
              fontSize: 24,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            },
            card.section,
          ),
        div(
          {
            display: "block",
            // Two lines at either size keep the text clear of the header.
            fontSize: card.title.length > 36 ? 68 : 84,
            fontWeight: 600,
            lineHeight: 1.04,
            letterSpacing: "-0.045em",
            lineClamp: 2,
          },
          card.title,
        ),
        card.description !== undefined &&
          div(
            {
              display: "block",
              marginTop: 28,
              color: color.muted,
              fontSize: 32,
              lineHeight: 1.4,
              lineClamp: 3,
            },
            card.description,
          ),
      ),
    ),
  );

/** Renders a 1200×630 PNG link preview card. */
export const renderCard = async (card: Card, library: Library | undefined): Promise<Uint8Array> => {
  const image = await satori(layout(card, library), { width, height, fonts });

  return new Resvg(image, { fitTo: { mode: "width", value: width } }).render().asPng();
};

/** The 180×180 Apple touch icon from the brand repository. iOS rounds the corners itself. */
export const touchIcon = (): Uint8Array => asset("apple-touch-icon.png");
