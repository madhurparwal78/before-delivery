export type Stitch = string;
export type ColourLetter = string;
export type Side = "RS" | "WS" | "RND";
export type RowState = "ok" | "error" | "empty";
export type Craft = "knit" | "crochet";
export type Mode = "flat" | "round";
export type Terms = "us" | "uk";

export interface Colour {
  letter: ColourLetter;
  name: string;
  hex: string;
}

export interface Repeat {
  id: string;
  fromCol: number;
  toCol: number;
  fromRow: number;
  toRow: number;
  times: number;
}
