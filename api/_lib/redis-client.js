// 共用的 Redis 連線 —— Vercel 這次接的整合（Upstash Marketplace）用的是
// 標準 `redis` npm 套件搭配 REDIS_URL 環境變數，不是舊版的 @vercel/kv。
// Serverless function 每次冷啟動才會重新連線，同一個執行環境（warm）
// 重複呼叫會共用同一條連線，不會每次都重新連。
const { createClient } = require("redis");

let clientPromise = null;

function getRedisClient() {
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) return null; // 還沒接 Redis（例如本機開發），呼叫端自己要處理拿不到的情況
  if (!clientPromise) {
    const client = createClient({ url });
    client.on("error", (err) => console.error("Redis Client Error", err));
    clientPromise = client.connect().then(() => client).catch((err) => {
      clientPromise = null; // 連線失敗就清掉，下次呼叫可以重試
      throw err;
    });
  }
  return clientPromise;
}

module.exports = { getRedisClient };
