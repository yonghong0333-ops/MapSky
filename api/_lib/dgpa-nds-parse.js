/**
 * DGPA nds.html 解析模組
 * 全縣停班 → work=suspended；分區/學校 → work=partial + districtsToday
 */
const SOURCE_URL = "https://www.dgpa.gov.tw/typh/daily/nds.html";

const COUNTIES = [
  "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣",
  "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市",
  "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

function emptyDay() {
  return { work: "normal", school: "normal", text: "照常上班、照常上課" };
}

function buildAllNormal(updatedAt, message) {
  return {
    ok: true,
    updatedAt,
    source: "dgpa",
    sourceUrl: SOURCE_URL,
    sourceName: "行政院人事行政總處",
    hasAnySuspension: false,
    message: message || "無停班停課訊息。",
    count: COUNTIES.length,
    items: COUNTIES.map((county) => ({
      county,
      today: emptyDay(),
      tomorrow: emptyDay(),
      notes: [],
      districtsToday: {},
      districtsTomorrow: {},
    })),
  };
}

function classifyPhrase(text) {
  const t = String(text || "");
  if (/尚未宣布|尚未列入警戒區|尚無訊息|無停班停課訊息/.test(t) && !/停止上班|停止上課/.test(t)) {
    return { work: "unknown", school: "unknown", text: t.trim() || "尚未宣布" };
  }
  if (/未納入警戒區|不納入警戒/.test(t) && !/停止上班|停止上課/.test(t)) {
    return { work: "out_of_alert", school: "out_of_alert", text: t.trim() };
  }
  const workSuspended = /停止上班/.test(t) && !/照常上班/.test(t);
  const schoolSuspended = /停止上課/.test(t) && !/照常上課/.test(t);
  const timePartial = /下午|晚上|中午|起停止|延後|提早/.test(t);
  let work = "normal";
  let school = "normal";
  if (workSuspended) work = timePartial ? "partial" : "suspended";
  if (schoolSuspended) school = timePartial ? "partial" : "suspended";
  if (/照常上班/.test(t) && !workSuspended) work = "normal";
  if (/照常上課/.test(t) && !schoolSuspended) school = "normal";
  return { work, school, text: t.trim() };
}

function parseCountyBlock(statusHtml) {
  const plain = String(statusHtml || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:FONT|font|span|p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  const notes = [];
  const districtsToday = {};
  const districtsTomorrow = {};
  let todayText = "";
  let tomorrowText = "";

  const lines = plain.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const districtLineRe =
    /^([\u4e00-\u9fff]{2,12}?(?:市|縣)?(?:區|鄉|鎮|市))\s*([^:：]*)[：:]\s*(.+)$/;

  for (const line of lines) {
    if (/^今天/.test(line) && !districtLineRe.test(line)) {
      todayText = line.replace(/^今天/, "").replace(/^[：:\s]+/, "");
      continue;
    }
    if (/^明天/.test(line) && !districtLineRe.test(line)) {
      tomorrowText = line.replace(/^明天/, "").replace(/^[：:\s]+/, "");
      continue;
    }

    const distPref = line.match(/^((?:[\u4e00-\u9fff]{1,6})(?:區|鄉|鎮))/);
    const dm = line.match(districtLineRe);
    if (dm || distPref) {
      let district = (distPref && distPref[1]) || (dm && dm[1]) || "";
      district = district.replace(/台/g, "臺").trim();
      const zoneInLine = line.match(/([\u4e00-\u9fff]{1,6}(?:區|鄉|鎮))/);
      if (zoneInLine) district = zoneInLine[1].replace(/台/g, "臺");
      district = district.replace(/^(?:臺北|新北|桃園|臺中|臺南|高雄)市/, "");
      if (!district && zoneInLine) district = zoneInLine[1].replace(/台/g, "臺");
      const body = ((dm && dm[3]) || line.split(/[：:]/).slice(1).join(":") || line).trim();
      notes.push(line);
      const isTomorrow = /明天/.test(body);
      const isToday = /今天/.test(body) || !isTomorrow;
      const phrase = classifyPhrase(body);
      const st =
        phrase.work === "suspended" ||
        phrase.work === "partial" ||
        phrase.school === "suspended" ||
        phrase.school === "partial"
          ? "closed"
          : phrase.work === "normal" && phrase.school === "normal"
            ? "normal"
            : "closed";
      if (district && isToday) districtsToday[district] = st;
      if (district && isTomorrow) districtsTomorrow[district] = st;
      continue;
    }

    if (/停止|照常|上班|上課|尚未宣布/.test(line)) {
      if (!todayText) todayText = line;
      notes.push(line);
    }
  }

  const hasDistrictClosures =
    Object.values(districtsToday).some((s) => s === "closed") ||
    Object.values(districtsTomorrow).some((s) => s === "closed");

  let today = classifyPhrase(
    todayText ||
      (hasDistrictClosures
        ? "部分區域停止"
        : plain.includes("明天")
          ? "照常上班、照常上課"
          : plain)
  );
  let tomorrow = classifyPhrase(tomorrowText || "照常上班、照常上課");

  if (hasDistrictClosures) {
    if (Object.values(districtsToday).some((s) => s === "closed")) {
      today = {
        work: "partial",
        school: "partial",
        text:
          todayText ||
          notes.filter((n) => /今天|下午|停止/.test(n)).slice(0, 3).join("；") ||
          "部分區域停止上班上課",
      };
    }
    if (Object.values(districtsTomorrow).some((s) => s === "closed")) {
      tomorrow = {
        work: "partial",
        school: "partial",
        text: tomorrowText || "部分區域明天停止上班上課",
      };
    }
  }

  if (/尚未宣布/.test(plain) && !/停止上班|停止上課/.test(plain)) {
    today = { work: "unknown", school: "unknown", text: "尚未宣布" };
    tomorrow = { work: "unknown", school: "unknown", text: "尚未宣布" };
  }

  return {
    today,
    tomorrow,
    notes,
    districtsToday,
    districtsTomorrow,
    raw: plain,
  };
}

function parseNdsHtml(html) {
  const updateMatch =
    html.match(/更新時間[：:]\s*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2}\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/) ||
    html.match(/更新時間[：:]\s*([^<\n]+)/);
  const updatedAt = updateMatch ? String(updateMatch[1]).trim() : null;

  if (/無停班停課訊息/.test(html) && !/停止上班/.test(html)) {
    return buildAllNormal(updatedAt, "無停班停課訊息。");
  }

  const items = [];
  const found = new Set();

  for (const county of COUNTIES) {
    const re = new RegExp(
      "<td[^>]*>\\s*(?:<[^>]+>\\s*)*" +
        county +
        "\\s*(?:</[^>]+>\\s*)*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>",
      "i"
    );
    const m = html.match(re);
    if (!m) continue;
    const block = parseCountyBlock(m[1]);
    items.push({
      county,
      today: block.today,
      tomorrow: block.tomorrow,
      notes: block.notes,
      districtsToday: block.districtsToday || {},
      districtsTomorrow: block.districtsTomorrow || {},
      raw: block.raw,
    });
    found.add(county);
  }

  for (const c of COUNTIES) {
    if (!found.has(c)) {
      items.push({
        county: c,
        today: emptyDay(),
        tomorrow: emptyDay(),
        notes: [],
        districtsToday: {},
        districtsTomorrow: {},
      });
    }
  }
  items.sort((a, b) => COUNTIES.indexOf(a.county) - COUNTIES.indexOf(b.county));

  const hasAny = items.some(
    (i) =>
      (i.today && (i.today.work === "suspended" || i.today.work === "partial")) ||
      (i.tomorrow && (i.tomorrow.work === "suspended" || i.tomorrow.work === "partial")) ||
      (i.districtsToday && Object.values(i.districtsToday).some((s) => s === "closed"))
  );

  return {
    ok: true,
    updatedAt,
    source: "dgpa",
    sourceUrl: SOURCE_URL,
    sourceName: "行政院人事行政總處",
    hasAnySuspension: hasAny,
    message: hasAny ? null : "無停班停課訊息。",
    count: items.length,
    items,
  };
}

module.exports = {
  parseNdsHtml,
  parseCountyBlock,
  classifyPhrase,
  emptyDay,
  COUNTIES,
  SOURCE_URL,
};
