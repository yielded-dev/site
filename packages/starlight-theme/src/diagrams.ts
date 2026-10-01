import libraryId from "virtual:yielded/library";

import { getLibrary } from "./libraries.ts";

/** The owner that diagrams mark with the accent color, such as "Yielded Auth". */
export const libraryOwner = `Yielded ${getLibrary(libraryId).name}`;

/** Splits diagram text written with backtick `code` spans into text and code parts. */
export const inline = (text: string) =>
  text.split("`").map((part, index) => (index % 2 === 1 ? { code: part } : { text: part }));
