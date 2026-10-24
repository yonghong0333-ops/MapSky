/**
 * GitHub Actions：高鐵／捷運／台鐵當日時刻表（一天一次）
 * 後台只提供時刻表；路線、車站、座標都由 App 本機內建，不在這裡產生。
 * 每個車站附上站名（name），讓本機 tools/fetch_rail_shapes.py 能把站名對到官方站碼。
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
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${apiPath} HTTP ${resp.status} ${text.slice(0, 120)}`);
  }
  return resp.json();
}

function writeJson(rel, obj) {
  const outPath = path.join(__dirname, "..", rel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(obj), "utf-8");
  console.log("wrote", rel, "bytes", fs.statSync(outPath).size);
}

function pushTrain(stations, sid, train, name) {
  sid = sid == null ? "" : String(sid).trim();
  if (!train.departureTime && train.arrivalTime) train.departureTime = train.arrivalTime;
  if (!sid || !train.departureTime) return;
  if (!stations[sid]) stations[sid] = { name: name || null, count: 0, trains: [] };
  else if (name && !stations[sid].name) stations[sid].name = name;
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
  for (const k of ["TrainTimetables", "DailyTrainTimetables", "StationTimetables", "Timetables", "TrainDateTimetables"]) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function trainMeta(row) {
  const info = row.DailyTrainInfo || row.TrainInfo || {};
  return {
    trainNo: info.TrainNo || row.TrainNo || null,
    direction: info.Direction != null ? Number(info.Direction) : row.Direction != null ? Number(row.Direction) : null,
    endingStationName: zhName(info.EndingStationName) || zhName(row.EndingStationName),
    startingStationName: zhName(info.StartingStationName) || zhName(row.StartingStationName),
  };
}

function ingestRows(stations, rows) {
  for (const row of rows) {
    const meta = trainMeta(row);
    const stops = row.StopTimes || row.StopTime || [];

    for (const key of ["OriginStopTime", "DestinationStopTime", "OriginStop", "DestinationStop"]) {
      const st = row[key];
      if (!st) continue;
      const sid = String(st.StationID || st.StationId || "");
      pushTrain(stations, sid, {
        ...meta,
        departureTime: st.DepartureTime || st.ArrivalTime || null,
        arrivalTime: st.ArrivalTime || null,
      }, zhName(st.StationName));
    }

    if (Array.isArray(stops) && stops.length) {
      for (const stop of stops) {
        const sid = String(stop.StationID || stop.StationId || "");
        pushTrain(stations, sid, {
          ...meta,
          departureTime: stop.DepartureTime || stop.ArrivalTime || null,
          arrivalTime: stop.ArrivalTime || null,
        }, zhName(stop.StationName));
      }
      continue;
    }

    if (row.DepartureTime || row.ArrivalTime) {
      const sid = String(row.StationID || row.StationId || "");
      pushTrain(stations, sid, {
        ...meta,
        departureTime: row.DepartureTime || row.ArrivalTime || null,
        arrivalTime: row.ArrivalTime || null,
      });
    }
  }
}

async function refreshThsr(token, date) {
  const base = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";
  const must = ["0990","1000","1010","1020","1030","1040","1050","1060","1070","1080","1090","1100"];
  const stations = {};

  const odPairs = [
    ["1000", "1100"],
    ["1100", "1000"],
    ["0990", "1100"],
    ["1100", "0990"],
    ["1050", "1100"],
    ["1100", "1050"],
    ["1000", "1090"],
    ["1090", "1000"],
    ["1000", "1080"],
    ["1080", "1000"],
  ];
  for (const [o, d] of odPairs) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await sleep(800 + attempt * 1500);
        const data = await tdxGet(token, base, `/DailyTimetable/OD/${o}/to/${d}/${date}?$top=500`);
        const rows = extractRows(data);
        console.log("THSR OD", o, "->", d, "rows", rows.length);
        ingestRows(stations, rows);
        if (rows.length) break;
      } catch (e) {
        console.warn("THSR OD", o, d, e.message);
        if (e.status === 429) break;
      }
    }
  }

  try {
    await sleep(800);
    const data = await tdxGet(token, base, `/DailyTimetable/TrainDate/${date}?$top=3000`);
    const rows = extractRows(data);
    console.log("THSR TrainDate rows", rows.length);
    ingestRows(stations, rows);
  } catch (e) {
    console.warn("THSR TrainDate", e.message);
  }

  const thsrNames = { "0990": "南港", "1000": "台北", "1010": "板橋", "1020": "桃園", "1030": "新竹", "1040": "苗栗",
    "1050": "台中", "1060": "彰化", "1070": "雲林", "1080": "嘉義", "1090": "台南", "1100": "左營" };
  for (const sid of must) {
    if (!stations[sid]) stations[sid] = { name: thsrNames[sid], count: 0, trains: [] };
    else if (!stations[sid].name) stations[sid].name = thsrNames[sid];
  }
  finalize(stations);
  const good = must.filter((s) => stations[s] && stations[s].count > 0).length;
  console.log("THSR stations with data", good);
  if (good < 3) {
    console.warn("THSR skip write: too few");
    return;
  }
  writeJson("api/_data/thsr-timetable.json", {
    updatedAt: new Date().toISOString(),
    date,
    source: "github-actions",
    stations,
  });
}

async function refreshKrtc(token) {
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
  if (Object.keys(stations).length < 5) {
    console.warn("KRTC skip write: empty");
    return;
  }
  writeJson("api/_data/krtc-timetable.json", {
    updatedAt: new Date().toISOString(),
    date: todayYmd(),
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

  for (let page = 0; page < 20; page++) {
    let rows = [];
    try {
      await sleep(250);
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
        }, zhName(stop.StationName));
      }
    }
    console.log("TRA page", page, "rows", rows.length, "stations so far", Object.keys(stations).length);
    if (rows.length < pageSize) break;
    skip += rows.length;
  }

  finalize(stations);
  const nonempty = Object.values(stations).filter((s) => s.count > 0).length;
  console.log("TRA trains", totalRows, "stations", Object.keys(stations).length, "with trains", nonempty);

  if (nonempty < 50) {
    console.warn("TRA skip write: too few stations", nonempty);
    return;
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
  console.log("refresh date (Taipei today only, once a day)", date);
  await refreshThsr(token, date);
  await sleep(2000);
  await refreshTra(token, date);
  await sleep(1500);
  await refreshKrtc(token);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
