import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";

// Office は HTTPS のアドインしか読み込まない。
// `npx office-addin-dev-certs install` で作られる証明書があれば使う。
const certDir = join(homedir(), ".office-addin-dev-certs");
const keyPath = join(certDir, "localhost.key");
const certPath = join(certDir, "localhost.crt");
const https = existsSync(keyPath) && existsSync(certPath)
  ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
  : undefined;

export default defineConfig({
  server: { port: 3000, strictPort: true, https },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        taskpane: resolve(__dirname, "taskpane.html"),
      },
    },
  },
});
