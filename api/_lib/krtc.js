/** krtc entry — 組裝 a+b（避免單檔過大上傳失敗） */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const a = fs.readFileSync(path.join(__dirname, "krtc-a.js"), "utf8");
const b = fs.readFileSync(path.join(__dirname, "krtc-b.js"), "utf8");
const m = { exports: {} };
const sandbox = {
  module: m,
  exports: m.exports,
  require,
  console,
  process,
  Buffer,
  setTimeout,
  clearTimeout,
  fetch,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
};
vm.runInNewContext(a + b, sandbox, { filename: "krtc.js" });
module.exports = sandbox.module.exports;
