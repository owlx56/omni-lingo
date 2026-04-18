// import { defineConfig } from "wxt";

// // See https://wxt.dev/api/config.html
// export default defineConfig({
//   srcDir: "src",
//   modules: ["@wxt-dev/module-solid"],
//   manifest: {
//     name: "OneLingo",
//     description: "跨平台翻译拓展",
//     permissions: ["storage"],
//     host_permissions: ["<all_urls>"],
//   },
// });
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "OneLingo",
    description: "跨平台翻译拓展",
    permissions: ["storage"],
    host_permissions: ["<all_urls>"],
  },
  dev: {
    server: {
      port: 3000,
    },
  },
  webExt: {
    disabled: true,
  },
});
