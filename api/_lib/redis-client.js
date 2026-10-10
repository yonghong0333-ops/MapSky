// 共用的 Redis 連線 —— Vercel 這次接的整合（Upstash Marketplace）用的是
// 標準 `redis` npm 套件搭配 REDIS_URL 環境變數，不是舊版的 @vercel/kv。
// Serverless function 每次冷啟動才會重新連線，同一個執行環境（warm）
// 重複呼叫會共用同一條連線，不會每次都重新連。
const { createClient } = require("redis");

let clientPromise = null;
let clientUrl = null;

const REDIS_HINT =
  "請到 Upstash 開啟 Redis，按 Connect，複製「Redis URL」（rediss://default:…@….upstash.io:6379）。" +
  "不要貼 https:// 開頭的 REST 網址、不要加引號、不要貼整行 redis-cli。改完環境變數後要重新部署才會生效。";

function redisUrlError(issue) {
  if (issue === "missing") return `缺少環境變數 REDIS_URL / KV_URL。${REDIS_HINT}`;
  if (issue === "https") return `REDIS_URL 是 https 的 REST 網址，登入用不到。${REDIS_HINT}`;
  if (issue === "wrong-protocol") return `REDIS_URL 的協定必須是 redis:// 或 rediss://。${REDIS_HINT}`;
  return `REDIS_URL 不是合法的 Redis 連線網址。${REDIS_HINT}`;
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function stripWrappingQuotes(value) {
  const pairs = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["「", "」"],
    ["`", "`"],
  ];
  for (const [open, close] of pairs) {
    if (value.startsWith(open) && value.endsWith(close) && value.length >= open.length + close.length + 1) {
      return value.slice(open.length, value.length - close.length).trim();
    }
  }
  return value;
}

function cleanRedisRaw(raw) {
  let s = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!s) return { empty: true, s: "", salvage: "none" };
  let salvage = "none";
  const unquoted = stripWrappingQuotes(s);
  if (unquoted !== s) {
    s = unquoted;
    salvage = "unquote";
  }
  const assign = s.match(/^(?:export\s+)?(?:REDIS_URL|KV_URL)\s*=\s*([\s\S]*)$/);
  if (assign) {
    s = stripWrappingQuotes(assign[1].trim());
    salvage = "strip-assign";
  }
  const blob = s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ");
  const found = blob.match(/rediss?:\/\/\S+/i);
  if (found) {
    const extracted = stripWrappingQuotes(found[0].replace(/[",'）)]+$/g, ""));
    if (extracted !== s) salvage = salvage === "none" ? "extract" : salvage;
    s = extracted;
  } else {
    s = blob.split(/\s+/)[0] || s;
  }
  return { empty: false, s, salvage };
}

function encodeUserinfo(s) {
  const m = String(s).match(/^(rediss?):\/\/([\s\S]+)$/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  let rest = m[2].trim().replace(/[)\].,;]+$/g, "");
  const at = rest.lastIndexOf("@");
  if (at <= 0) return null;
  const userinfo = rest.slice(0, at);
  let hostpart = rest.slice(at + 1).split("?")[0].split("#")[0];
  const slash = hostpart.indexOf("/");
  if (slash >= 0) hostpart = hostpart.slice(0, slash);
  const colon = userinfo.indexOf(":");
  if (colon <= 0) return null;
  const user = userinfo.slice(0, colon);
  const pass = userinfo.slice(colon + 1);
  if (!user || !pass || !hostpart || !/^[^/\s]+$/.test(hostpart)) return null;
  return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostpart}`;
}

function tryBuild(s, salvage) {
  const direct = safeUrl(s);
  if (direct && (direct.protocol === "redis:" || direct.protocol === "rediss:")) {
    return { url: s, issue: "ok", protocol: direct.protocol.slice(0, -1), salvage };
  }
  const rebuilt = encodeUserinfo(s);
  if (rebuilt) {
    const encoded = safeUrl(rebuilt);
    if (encoded && (encoded.protocol === "redis:" || encoded.protocol === "rediss:")) {
      return { url: rebuilt, issue: "ok", protocol: encoded.protocol.slice(0, -1), salvage: "encode-userinfo" };
    }
  }
  if (direct && (direct.protocol === "https:" || direct.protocol === "http:")) {
    return { url: null, issue: "https", protocol: direct.protocol.slice(0, -1), salvage };
  }
  if (direct) {
    return { url: null, issue: "wrong-protocol", protocol: (direct.protocol || "other:").slice(0, -1) || "other", salvage };
  }
  return { url: null, issue: "unparseable", protocol: null, salvage };
}

function analyzeRedisRaw(raw) {
  const cleaned = cleanRedisRaw(raw);
  if (cleaned.empty) return { url: null, issue: "missing", protocol: null, salvage: "none" };
  return tryBuild(cleaned.s, cleaned.salvage);
}


// 整合自動產生的 REDIS_URL 在 Vercel 上無法手動編輯。
// 若資料庫要求加密連線，可另外新增環境變數 REDIS_FORCE_TLS=1，
// 這裡會把 redis:// 開頭改成 rediss://（預設不啟用，行為不變）。
function applyTlsOverride(url) {
  if (!url) return url;
  if (String(process.env.REDIS_FORCE_TLS || "").trim() !== "1") return url;
  return /^redis:\/\//i.test(url) ? url.replace(/^redis:\/\//i, "rediss://") : url;
}

function pickRedisUrl() {
  const hasRedis = Boolean(String(process.env.REDIS_URL || "").trim());
  const hasKv = Boolean(String(process.env.KV_URL || "").trim());
  const primary = analyzeRedisRaw(process.env.REDIS_URL);
  if (primary.url) return { configured: true, source: "REDIS_URL", ...primary, url: applyTlsOverride(primary.url), protocol: applyTlsOverride(primary.url).startsWith("rediss") ? "rediss" : primary.protocol };
  const fallback = analyzeRedisRaw(process.env.KV_URL);
  if (fallback.url) return { configured: true, source: "KV_URL", ...fallback, salvage: "fallback-kv", url: applyTlsOverride(fallback.url), protocol: applyTlsOverride(fallback.url).startsWith("rediss") ? "rediss" : fallback.protocol };
  const failed = hasRedis ? primary : hasKv ? fallback : primary;
  return { configured: hasRedis || hasKv, source: null, ...failed, url: null };
}

function inspectRedisConfig() {
  const picked = pickRedisUrl();
  return {
    configured: picked.configured,
    connectable: Boolean(picked.url),
    protocol: picked.protocol,
    issue: picked.issue,
    salvage: picked.salvage,
    source: picked.source,
  };
}

function getRedisClient() {
  const picked = pickRedisUrl();
  if (!picked.url) {
    if (!picked.configured) return null;
    throw new Error(redisUrlError(picked.issue));
  }
  if (!clientPromise || clientUrl !== picked.url) {
    let client;
    try {
      client = createClient({
        url: picked.url,
        socket: {
          connectTimeout: 5000,
          // 連不上時最多重試 2 次就放棄並回報錯誤，避免函式一直卡到逾時（504）
          reconnectStrategy: (retries) => (retries >= 2 ? new Error("Redis 連線失敗（已重試 2 次）") : 300),
        },
      });
    } catch (e) {
      throw new Error(redisUrlError(picked.issue === "ok" ? "unparseable" : picked.issue));
    }
    client.on("error", (err) => console.error("Redis Client Error", err && err.message ? err.message : "error"));
    client.on("end", () => { if (clientUrl === picked.url) { clientPromise = null; clientUrl = null; } });
    const url = picked.url;
    clientPromise = client.connect().then(() => client).catch((err) => {
      if (clientPromise && clientUrl === url) {
        clientPromise = null;
        clientUrl = null;
      }
      throw err;
    });
    clientUrl = url;
  }
  return clientPromise;
}

module.exports = { getRedisClient, inspectRedisConfig };
