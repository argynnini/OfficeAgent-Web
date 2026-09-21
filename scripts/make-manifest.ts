/**
 * 開発用の manifest.xml (https://localhost:3000) から、本番 (GitHub Pages) 用のマニフェストを dist/manifest.xml に生成する。
 *
 *   SITE_URL=https://argynnini.github.io/OfficeAgent-Web npx tsx scripts/make-manifest.ts
 *
 * - URL は SITE_URL に置き換える (末尾のスラッシュなし)。AppDomain は origin だけ。
 * - アドイン ID は本番用に別の値にする (開発用を読み込んだ Office と、同じ ID で衝突しないように)。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DEV_ORIGIN = "https://localhost:3000";
const PROD_ID = "32d4180e-ad47-428c-91ad-dd4bf4121ac3";

const site = (process.env.SITE_URL ?? "https://argynnini.github.io/OfficeAgent-Web").replace(/\/+$/, "");
const origin = new URL(site).origin;

let xml = readFileSync("manifest.xml", "utf8");
const devAppDomain = `<AppDomain>${DEV_ORIGIN}</AppDomain>`;
if (!xml.includes(devAppDomain)) throw new Error("manifest.xml に開発用の AppDomain が見つかりません");

xml = xml
  // AppDomain は origin だけ。先に置き換える (下の replaceAll に巻き込まれないように)
  .replace(devAppDomain, `<AppDomain>${origin}</AppDomain>`)
  .replaceAll(DEV_ORIGIN, site)
  .replace(/<Id>[^<]+<\/Id>/, `<Id>${PROD_ID}</Id>`);

if (xml.includes("localhost")) throw new Error("localhost が残っています");

mkdirSync("dist", { recursive: true });
writeFileSync("dist/manifest.xml", xml);
console.log(`dist/manifest.xml を生成しました (${site})`);
