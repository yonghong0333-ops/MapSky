/**
 * GitHub Actions：高鐵／捷運／台鐵當日時刻表
 * 台鐵不再限白名單，當日班表停靠站全部入快取
 * env: TDX_CLIENT_ID, TDX_CLIENT_SECRET
 */
const fs = require("fs");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  if (!resp.ok) throw new Error("TDX token HTTP " + resp.status);
  return (await resp.json()).access_token;
}

async function tdxGet(token, base, apiPath) {
  const join = apiPath.includes("?") ? "&" : "?";
  const url = `${base}${apiPath}${join}$format=JSON`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (resp.status === 429) {
    const e = new Error("tdx-rate-limit");
    e.status = 429;
    throw e;
  }
  if (!resp.ok) throw new Error(`${apiPath} HTTP ${resp.status}`);
  return resp.json();
}

function writeJson(rel, obj) {
  const outPath = path.join(__dirname, "..", rel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(obj), "utf-8");
  console.log("wrote", rel, "bytes", fs.statSync(outPath).size);
}

function pushTrain(stations, sid, train) {
  if (!sid || !train.departureTime) return;
  if (!stations[sid]) stations[sid] = { count: 0, trains: [] };
  stations[sid].trains.push(train);
}

function finalize(stations) {
  for (const sid of Object.keys(stations)) {
    const seen = new Set();
    stations[sid].trains = stations[sid].trains
      .filter((t) => {
        const k = `${t.trainNo}|${t.departureTime}`;
        if (!t.departureTime || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => String(a.departureTime).localeCompare(String(b.departureTime)));
    stations[sid].count = stations[sid].trains.length;
  }
}

function extractRows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of ["TrainTimetables", "DailyTrainTimetables", "StationTimetables", "Timetables"]) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

async function refreshThsr(token, date) {
  const base = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";
  const stations = {};
  let todayRows = [];
  try {
    const data = await tdxGet(token, base, "/DailyTimetable/Today?$top=2000");
    todayRows = extractRows(data);
    console.log("THSR Today rows", todayRows.length);
  } catch (e) {
    console.warn("THSR Today", e.message);
  }
  for (const row of todayRows) {
    const info = row.DailyTrainInfo || {};
    const stops = row.StopTimes || [];
    for (const stop of stops) {
      const sid = String(stop.StationID || "");
      pushTrain(stations, sid, {
        trainNo: info.TrainNo || row.TrainNo || null,
        direction: info.Direction != null ? Number(info.Direction) : null,
        departureTime: stop.DepartureTime || stop.ArrivalTime || null,
        arrivalTime: stop.ArrivalTime || null,
        endingStationName: zhName(info.EndingStationName),
        startingStationName: zhName(info.StartingStationName),
      });
    }
  }
  finalize(stations);
  const ids = Object.keys(stations).sort();
  console.log("THSR stations", ids.length, ids.join(","));
  for (const sid of ids) console.log("THSR", sid, stations[sid].count);
  writeJson("api/_data/thsr-timetable.json", {
    updatedAt: new Date().toISOString(),
    date,
    source: "github-actions",
    stations,
  });
}

async function refreshKrtc(token, date) {
  const base = "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro";
  const stations = {};
  for (const sys of ["KRTC", "KLRT"]) {
    try {
      await sleep(400);
      const data = await tdxGet(token, base, `/StationTimeTable/${sys}?$top=5000`);
      const list = Array.isArray(data) ? data : [];
      for (const row of list) {
        const sid = String(row.StationID || "").toUpperCase();
        if (!sid) continue;
        if (!stations[sid]) stations[sid] = { count: 0, items: [] };
        const tables = row.Timetables || row.StationTimetables || null;
        if (Array.isArray(tables) && tables.length) {
          for (const t of tables) {
            stations[sid].items.push({
              stationId: sid,
              stationName: zhName(row.StationName) || sid,
              direction: t.Direction != null ? Number(t.Direction) : row.Direction != null ? Number(row.Direction) : null,
              destinationName: zhName(t.DestinationStationName) || zhName(row.DestinationStationName),
              departureTime: t.DepartureTime || t.ArrivalTime || null,
              arrivalTime: t.ArrivalTime || null,
              system: sys,
            });
          }
        } else {
          stations[sid].items.push({
            stationId: sid,
            stationName: zhName(row.StationName) || sid,
            direction: row.Direction != null ? Number(row.Direction) : null,
            destinationName: zhName(row.DestinationStationName),
            departureTime: row.DepartureTime || row.ArrivalTime || null,
            arrivalTime: row.ArrivalTime || null,
            system: sys,
          });
        }
      }
      console.log("KRTC system", sys, "rows", list.length);
    } catch (e) {
      console.warn("KRTC", sys, e.message);
    }
  }
  for (const sid of Object.keys(stations)) {
    const seen = new Set();
    stations[sid].items = stations[sid].items
      .filter((t) => {
        const k = `${t.direction}|${t.destinationName}|${t.departureTime}`;
        if (!t.departureTime || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => String(a.departureTime).localeCompare(String(b.departureTime)));
    stations[sid].count = stations[sid].items.length;
  }
  writeJson("api/_data/krtc-timetable.json", {
    updatedAt: new Date().toISOString(),
    date,
    source: "github-actions",
    stations,
  });
}

async function refreshTra(token, date) {
  const base = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA";
  const stations = {};
  const pageSize = 500;
  let skip = 0;
  let totalRows = 0;
  let firstNo = null;

  for (let page = 0; page < 30; page++) {
    let rows = [];
    try {
      const data = await tdxGet(
        token,
        base,
        `/DailyTrainTimetable/Today?$top=${pageSize}&$skip=${skip}`
      );
      rows = extractRows(data);
    } catch (e) {
      console.warn("TRA Today page", page, e.message);
      break;
    }
    if (!rows.length) break;
    const head = (rows[0].DailyTrainInfo && rows[0].DailyTrainInfo.TrainNo) || rows[0].TrainNo || "";
    if (page === 0) firstNo = head;
    else if (head && head === firstNo) {
      console.warn("TRA pagination ignored, stop");
      break;
    }
    totalRows += rows.length;
    for (const row of rows) {
      const info = row.DailyTrainInfo || row.TrainInfo || {};
      const stops = row.StopTimes || row.StopTime || [];
      if (!Array.isArray(stops)) continue;
      for (const stop of stops) {
        const sid = String(stop.StationID || stop.StationId || "");
        pushTrain(stations, sid, {
          trainNo: info.TrainNo || row.TrainNo || null,
          trainType: zhName(info.TrainTypeName) || info.TrainType || null,
          direction: info.Direction != null ? Number(info.Direction) : null,
          departureTime: stop.DepartureTime || stop.ArrivalTime || null,
          destinationName: zhName(info.EndingStationName) || zhName(row.EndingStationName),
          startingStationName: zhName(info.StartingStationName),
        });
      }
    }
    console.log("TRA page", page, "rows", rows.length, "stations so far", Object.keys(stations).length);
    if (rows.length < pageSize) break;
    skip += rows.length;
    await sleep(250);
  }

  finalize(stations);
  const nonempty = Object.values(stations).filter((s) => s.count > 0).length;
  console.log("TRA trains", totalRows, "stations", Object.keys(stations).length, "with trains", nonempty);

  writeJson("api/_data/tra-timetable.json", {
    updatedAt: new Date().toISOString(),
    date,
    source: "github-actions",
    stations,
  });
}

async function main() {
  const date = todayYmd();
  const token = await getToken();
  console.log("refresh date (Taipei today only)", date);
  await refreshThsr(token, date);
  await refreshKrtc(token, date);
  await refreshTra(token, date);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
