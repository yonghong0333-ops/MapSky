/**
 * 由 GitHub Actions 定時執行：打 TDX 拉當日高鐵站表，寫入 api/_data/thsr-timetable.json
 * 環境變數：TDX_CLIENT_ID、TDX_CLIENT_SECRET
 */
const fs = require("fs");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";

const STATION_IDS = [
  "0990", "1000", "1010", "1020", "1030", "1040",
  "1050", "1060", "1070", "1080", "1090", "1100",
];

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function zhName(obj) {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  return obj.Zh_tw || obj.Zh || obj.En || null;
}

async function getToken() {
  const clientId = process.env.TDX_CLIENT_ID || "";
  const clientSecret = process.env.TDX_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) throw new Error("缺少 TDX_CLIENT_ID / TDX_CLIENT_SECRET");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error("TDX token 失敗 HTTP " + resp.status);
  const j = await resp.json();
  return j.access_token;
}

async function tdxGet(token, apiPath) {
  const url = `${API_BASE}${apiPath}${apiPath.includes("?") ? "&" : "?"}$format=JSON`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (resp.status === 429) {
    const err = new Error("tdx-rate-limit");
    err.status = 429;
    throw err;
  }
  if (!resp.ok) throw new Error(`TDX ${apiPath} HTTP ${resp.status}`);
  return resp.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapStationRows(list, sid) {
  const trains = [];
  for (const row of list || []) {
    const info = row.DailyTrainInfo || {};
    if (row.DepartureTime || row.ArrivalTime) {
      trains.push({
        trainNo: row.TrainNo || info.TrainNo || null,
        direction: row.Direction != null ? Number(row.Direction) : null,
        departureTime: row.DepartureTime || row.ArrivalTime || null,
        arrivalTime: row.ArrivalTime || null,
        endingStationName: zhName(row.EndingStationName) || zhName(info.EndingStationName),
        startingStationName: zhName(row.StartingStationName) || zhName(info.StartingStationName),
      });
      continue;
    }
    const stops = row.StopTimes || [];
    const stop = stops.find((x) => String(x.StationID || x.StationId || "") === String(sid));
    if (!stop) continue;
    trains.push({
      trainNo: info.TrainNo || row.TrainNo || null,
      direction: info.Direction != null ? Number(info.Direction) : null,
      departureTime: stop.DepartureTime || stop.ArrivalTime || null,
      arrivalTime: stop.ArrivalTime || null,
      endingStationName: zhName(info.EndingStationName),
      startingStationName: zhName(info.StartingStationName),
    });
  }
  const seen = new Set();
  return trains
    .filter((t) => {
      const k = `${t.trainNo}|${t.departureTime}`;
      if (!t.departureTime || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => String(a.departureTime).localeCompare(String(b.departureTime)));
}

async function main() {
  const date = todayYmd();
  const token = await getToken();
  const stations = {};

  let todayRows = [];
  try {
    const data = await tdxGet(token, "/DailyTimetable/Today?$top=500");
    todayRows = Array.isArray(data) ? data : data.TrainTimetables || [];
    console.log("Today rows", todayRows.length);
  } catch (e) {
    console.warn("Today failed", e.message);
  }

  for (const sid of STATION_IDS) {
    let trains = mapStationRows(todayRows, sid);
    if (!trains.length) {
      try {
        await sleep(400);
        const data = await tdxGet(
          token,
          `/DailyTimetable/Station/${encodeURIComponent(sid)}/${encodeURIComponent(date)}?$top=500`
        );
        const list = Array.isArray(data) ? data : [];
        trains = mapStationRows(list, sid);
      } catch (e) {
        console.warn("station", sid, e.message);
      }
    }
    stations[sid] = { count: trains.length, trains };
    console.log(sid, trains.length);
  }

  const out = {
    updatedAt: new Date().toISOString(),
    date,
    source: "github-actions",
    stations,
  };

  const outPath = path.join(__dirname, "..", "api", "_data", "thsr-timetable.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log("wrote", outPath, "date", date);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
