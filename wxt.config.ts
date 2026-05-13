import { defineConfig } from "wxt";

function ensureScriptSrcOrigin(
  csp: string | undefined,
  origin: string,
): string {
  const parts = (csp ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  let foundScriptSrc = false;

  for (let i = 0; i < parts.length; i++) {
    const tokens = parts[i]?.split(/\s+/).filter(Boolean) ?? [];
    if (tokens[0] !== "script-src") continue;
    foundScriptSrc = true;
    if (!tokens.includes(origin)) tokens.push(origin);
    parts[i] = tokens.join(" ");
  }

  if (!foundScriptSrc) parts.push(`script-src 'self' ${origin}`);
  if (!parts.some((part) => part.startsWith("object-src "))) {
    parts.push("object-src 'self'");
  }

  return `${parts.join("; ")};`;
}

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "OneLingo",
    description: "跨平台翻译拓展",
    permissions: ["storage", "unlimitedStorage"],
    host_permissions: ["<all_urls>"],
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    // dev 模式下 popup 脚本从 Vite HTTP server (localhost:3000) 加载。
    // WXT 本身会将 wxt.server.origin（Vite 实际绑定端口）追加到 CSP，
    // 但选择性重建时可能产生 manifest 与 popup.html 跨会话端口不一致。
    // 以此自定义 CSP 为基础，确保 3000 始终可用；WXT 会在其之上追加当次端口。
    // object-src 'self' 保留 MV3 默认行为。生产包的 localhost 条目无害。
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000; object-src 'self';",
    },
  },
  hooks: {
    // WXT dev 模式会重写 CSP 并追加动态端口，这里兜底保留 3000，
    // 避免 popup.html（常驻 3000）与 manifest CSP 端口错位。
    "build:manifestGenerated": (_wxt, manifest) => {
      manifest.options_ui = {
        page: "options.html",
        open_in_tab: true,
      };

      const csp = manifest.content_security_policy;
      if (!csp || typeof csp === "string") return;
      csp.extension_pages = ensureScriptSrcOrigin(
        csp.extension_pages,
        "http://localhost:3000",
      );
      csp.sandbox = ensureScriptSrcOrigin(csp.sandbox, "http://localhost:3000");
    },
  },
  webExt: {
    disabled: true,
  },
});
