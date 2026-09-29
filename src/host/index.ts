import { connectGoogleHost, isGoogleApp } from "./google";
import { connectOfficeHost } from "./office";
import type { Host } from "./types";

export type { DocumentEventHandlers, Host } from "./types";

/** 作業ウィンドウを載せているアプリにつなぐ。どのアプリの中でもない (ブラウザで直接開いたなど) なら undefined */
export async function connectHost(): Promise<Host | undefined> {
  // Google のサイドバー (apps-script/Sidebar.html) は、taskpane.html?host=google&app=docs のように開く
  const params = new URLSearchParams(location.search);
  if (params.get("host") === "google") {
    const app = params.get("app");
    return isGoogleApp(app) ? connectGoogleHost(app) : undefined;
  }
  // office.js は taskpane.html が読み込む
  if (typeof Office !== "undefined") return connectOfficeHost();
  return undefined;
}
