import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "OneLingo",
    description: "跨平台翻译拓展",
    permissions: ["storage"],
    host_permissions: ["<all_urls>"],
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
  webExt: {
    disabled: true,
  },
});
