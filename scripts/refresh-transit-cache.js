/**
 * GitHub Actions：高鐵／捷運／台鐵當日時刻表
 * 台鐵改為 DailyTrainTimetable/Today 再依站篩選（與高鐵相同）
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
  fs.writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");
  console.log("wrote", rel, "bytes", fs.statSync(outPath).size);
}

async function refreshThsr(token, date) {
  const base = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";
  const ids = ["0990","1000","1010","1020","1030","1040","1050","1060","1070","1080","1090","1100"];
  const stations = {};
  let todayRows = [];
  try {
    const data = await tdxGet(token, base, "/DailyTimetable/Today?$top=500");
    todayRows = Array.isArray(data) ? data : data.TrainTimetables || [];
  } catch (e) {
    console.warn("THSR Today", e.message);
  }
  for (const sid of ids) {
    const trains = [];
    for (const row of todayRows) {
      const info = row.DailyTrainInfo || {};
      const stop = (row.StopTimes || []).find((x) => String(x.StationID) === sid);
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
    if (!trains.length) {
      try {
        await sleep(300);
        const data = await tdxGet(token, base, `/DailyTimetable/Station/${sid}/${date}?$top=500`);
        for (const row of Array.isArray(data) ? data : []) {
          const info = row.DailyTrainInfo || {};
          trains.push({
            trainNo: row.TrainNo || info.TrainNo || null,
            direction: row.Direction != null ? Number(row.Direction) : null,
            departureTime: row.DepartureTime || row.ArrivalTime || null,
            arrivalTime: row.ArrivalTime || null,
            endingStationName: zhName(row.EndingStationName) || zhName(info.EndingStationName),
            startingStationName: zhName(row.StartingStationName) || zhName(info.StartingStationName),
          });
        }
      } catch (e) {
        console.warn("THSR", sid, e.message);
      }
    }
    const seen = new Set();
    const uniq = trains.filter((t) => {
      const k = `${t.trainNo}|${t.departureTime}`;
      if (!t.departureTime || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    uniq.sort((a, b) => String(a.departureTime).localeCompare(String(b.departureTime)));
    stations[sid] = { count: uniq.length, trains: uniq };
    console.log("THSR", sid, uniq.length);
  }
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
      const data = await tdxGet(token, base, `/StationTimeTable/${sys}?$top=3000`);
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
  const ids = ["1000","1080","1100","3300","3340","3360","4220","4270","4272","4340","4400","4110","4080"];
  const idSet = new Set(ids);
  const stations = {};
  for (const sid of ids) stations[sid] = { count: 0, trains: [] };

  let todayRows = [];
  try {
    const data = await tdxGet(token, base, "/DailyTrainTimetable/Today?$top=3000");
    if (Array.isArray(data)) todayRows = data;
    else if (data && Array.isArray(data.TrainTimetables)) todayRows = data.TrainTimetables;
    else if (data && Array.isArray(data.StationTimetables)) todayRows = data.StationTimetables;
    else if (data && Array.isArray(data.DailyTrainTimetables)) todayRows = data.DailyTrainTimetables;
    console.log("TRA Today rows", todayRows.length);
  } catch (e) {
    console.warn("TRA Today", e.message);
  }

  for (const row of todayRows) {
    const info = row.DailyTrainInfo || row.TrainInfo || {};
    const stops = row.StopTimes || row.StopTime || [];
    if (!Array.isArray(stops) || !stops.length) continue;
    for (const stop of stops) {
      const sid = String(stop.StationID || stop.StationId || "");
      if (!idSet.has(sid)) continue;
      const dep = stop.DepartureTime || stop.ArrivalTime || null;
      if (!dep) continue;
      stations[sid].trains.push({
        trainNo: info.TrainNo || row.TrainNo || null,
        trainType: zhName(info.TrainTypeName) || info.TrainType || null,
        direction: info.Direction != null ? Number(info.Direction) : null,
        departureTime: dep,
        destinationName: zhName(info.EndingStationName) || zhName(row.EndingStationName),
        startingStationName: zhName(info.StartingStationName),
      });
    }
  }

  for (const sid of ids) {
    if (stations[sid].trains.length) continue;
    try {
      await sleep(400);
      const data = await tdxGet(token, base, `/GeneralStationTimetable/Station/${sid}?$top=500`);
      const list = Array.isArray(data)
        ? data
        : data.StationTimetables || data.GeneralStationTimetables || data.TrainTimetables || [];
      for (const row of list) {
        const tables = row.Timetables || row.StationTimetables || null;
        if (Array.isArray(tables)) {
          for (const t of tables) {
            stations[sid].trains.push({
              trainNo: t.TrainNo || row.TrainNo || null,
              trainType: zhName(t.TrainTypeName) || t.TrainType || null,
              direction: t.Direction != null ? Number(t.Direction) : null,
              departureTime: t.DepartureTime || t.ArrivalTime || null,
              destinationName: zhName(t.DestinationStationName) || zhName(t.EndingStationName),
              startingStationName: null,
            });
          }
        } else {
          stations[sid].trains.push({
            trainNo: row.TrainNo || null,
            trainType: zhName(row.TrainTypeName) || row.TrainType || null,
            direction: row.Direction != null ? Number(row.Direction) : null,
            departureTime: row.DepartureTime || row.ArrivalTime || null,
            destinationName: zhName(row.DestinationStationName) || zhName(row.EndingStationName),
            startingStationName: null,
          });
        }
      }
      console.log("TRA GeneralStation", sid, stations[sid].trains.length);
    } catch (e) {
      console.warn("TRA General", sid, e.message);
    }
  }

  const odPairs = [
    ["3340", "3300"], ["3340", "3360"], ["3300", "3340"],
    ["4340", "4400"], ["4400", "4340"], ["4340", "4220"],
    ["1000", "1080"], ["4220", "4400"],
  ];
  for (const [origin, dest] of odPairs) {
    if (!idSet.has(origin)) continue;
    if (stations[origin].trains.length > 5) continue;
    try {
      await sleep(400);
      const data = await tdxGet(
        token,
        base,
        `/DailyTrainTimetable/OD/${origin}/to/${dest}/${date}?$top=300`
      );
      const list = Array.isArray(data) ? data : data.TrainTimetables || [];
      for (const row of list) {
        const info = row.DailyTrainInfo || {};
        const stops = row.StopTimes || [];
        const originStop = stops.find((x) => String(x.StationID) === origin) || stops[0];
        const dep = originStop && (originStop.DepartureTime || originStop.ArrivalTime);
        if (!dep) continue;
        stations[origin].trains.push({
          trainNo: info.TrainNo || row.TrainNo || null,
          trainType: zhName(info.TrainTypeName) || null,
          direction: info.Direction != null ? Number(info.Direction) : null,
          departureTime: dep,
          destinationName: zhName(info.EndingStationName),
          startingStationName: zhName(info.StartingStationName),
        });
      }
      console.log("TRA OD", origin, "->", dest, stations[origin].trains.length);
    } catch (e) {
      console.warn("TRA OD", origin, dest, e.message);
    }
  }

  for (const sid of ids) {
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
    console.log("TRA", sid, stations[sid].count);
  }

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
