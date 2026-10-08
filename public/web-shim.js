/* Emergency bootstrap: load known-good web-shim, then gyro-shine */
(function () {
  var GOOD = "https://cdn.jsdelivr.net/gh/yonghong0333-ops/MapSky@f9fe3b0635d78e5415cffbe616806e3496a828b5/public/web-shim.js";
  var s = document.createElement("script");
  s.src = GOOD;
  s.onload = function () {
    var g = document.createElement("script");
    g.src = "gyro-shine.js";
    document.body ? document.body.appendChild(g) : document.documentElement.appendChild(g);
  };
  s.onerror = function () {
    console.error("[MapSky] failed to load bootstrap web-shim from CDN");
  };
  (document.body || document.documentElement).appendChild(s);
})();
