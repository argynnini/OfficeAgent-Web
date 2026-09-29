import { connectOfficeHost } from "./office";
import type { Host } from "./types";

export type { DocumentEventHandlers, Host } from "./types";

/** 作業ウィンドウを載せているアプリにつなぐ。どのアプリの中でもない (ブラウザで直接開いたなど) なら undefined */
export async function connectHost(): Promise<Host | undefined> {
  // office.js は taskpane.html だけが読み込む
  if (typeof Office !== "undefined") return connectOfficeHost();
  return undefined;
}
