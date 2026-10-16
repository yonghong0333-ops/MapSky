/**
 * 太陽／月亮即時天文位置（方位角、高度角等）
 * 以觀測者緯度、經度、時間計算；不依賴 CWA。
 * 演算法參考 Meeus / NOAA 簡化型，一般用途誤差約 0.1°～1° 內。
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function toJulian(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function normalize360(x) {
  x = x % 360;
  if (x < 0) x += 360;
  return x;
}

function normalize180(x) {
  x = normalize360(x + 180) - 180;
  return x;
}

function sunPosition(lat, lon, date) {
  const d = date instanceof Date ? date : new Date(date);
  const jd = toJulian(d);
  const T = (jd - 2451545.0) / 36525;

  const L0 = normalize360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = normalize360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const Mrad = M * DEG;

  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad) +
    0.000289 * Math.sin(3 * Mrad);

  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  const eps0 =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);

  const lambdaRad = lambda * DEG;
  const epsRad = eps * DEG;

  const alpha = Math.atan2(Math.cos(epsRad) * Math.sin(lambdaRad), Math.cos(lambdaRad)) * RAD;
  const delta = Math.asin(Math.sin(epsRad) * Math.sin(lambdaRad)) * RAD;
  const ra = normalize360(alpha);
  const dec = delta;

  const gmst =
    normalize360(
      280.46061837 +
        360.98564736629 * (jd - 2451545) +
        0.000387933 * T * T -
        (T * T * T) / 38710000
    );
  const lst = normalize360(gmst + lon);
  const ha = normalize180(lst - ra);

  const latRad = lat * DEG;
  const decRad = dec * DEG;
  const haRad = ha * DEG;

  const sinAlt =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const altitude = Math.asin(Math.min(1, Math.max(-1, sinAlt))) * RAD;

  const y = -Math.sin(haRad);
  const x =
    Math.tan(decRad) * Math.cos(latRad) -
    Math.sin(latRad) * Math.cos(haRad);
  let azimuth = Math.atan2(y, x) * RAD;
  azimuth = normalize360(azimuth);

  let altitudeApp = altitude;
  if (altitude > -1) {
    const R =
      1.02 /
      Math.tan((altitude + 10.3 / (altitude + 5.11)) * DEG);
    altitudeApp = altitude + R / 60;
  }

  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const v = M + C;
  const r = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(v * DEG));

  const y2 = Math.tan(epsRad / 2);
  const y2s = y2 * y2;
  const eot =
    4 *
    RAD *
    (y2s * Math.sin(2 * L0 * DEG) -
      2 * e * Math.sin(Mrad) +
      4 * e * y2s * Math.sin(Mrad) * Math.cos(2 * L0 * DEG) -
      0.5 * y2s * y2s * Math.sin(4 * L0 * DEG) -
      1.25 * e * e * Math.sin(2 * Mrad));

  return {
    body: "sun",
    altitude: round4(altitude),
    altitudeApparent: round4(altitudeApp),
    azimuth: round4(azimuth),
    azimuthFromNorth: round4(azimuth),
    rightAscension: round4(ra),
    declination: round4(dec),
    hourAngle: round4(ha),
    eclipticLongitude: round4(lambda),
    distanceAU: round6(r),
    equationOfTimeMin: round4(eot),
    isUp: altitudeApp > 0,
    phaseLabel: null,
  };
}

function moonPosition(lat, lon, date) {
  const d = date instanceof Date ? date : new Date(date);
  const jd = toJulian(d);
  const T = (jd - 2451545.0) / 36525;
  const Lp = normalize360(218.3164477 + 481267.88123421 * T);
  const D = normalize360(297.8501921 + 445267.1114034 * T);
  const M = normalize360(357.5291092 + 35999.0502909 * T);
  const Mp = normalize360(134.9633964 + 477198.8675055 * T);
  const F = normalize360(93.272095 + 483202.0175233 * T);

  const Dr = D * DEG;
  const Mr = M * DEG;
  const Mpr = Mp * DEG;
  const Fr = F * DEG;

  let lonEcl =
    Lp +
    6.289 * Math.sin(Mpr) +
    1.274 * Math.sin(2 * Dr - Mpr) +
    0.658 * Math.sin(2 * Dr) +
    0.214 * Math.sin(2 * Mpr) -
    0.186 * Math.sin(Mr) -
    0.114 * Math.sin(2 * Fr);
  lonEcl = normalize360(lonEcl);

  let latEcl =
    5.128 * Math.sin(Fr) +
    0.281 * Math.sin(Mpr + Fr) +
    0.278 * Math.sin(Mpr - Fr) +
    0.173 * Math.sin(2 * Dr - Fr);

  const dist =
    385001 -
    20905 * Math.cos(Mpr) -
    3699 * Math.cos(2 * Dr - Mpr) -
    2956 * Math.cos(2 * Dr) -
    570 * Math.cos(2 * Mpr);

  const eps =
    (23 +
      (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60) *
    DEG;
  const lonR = lonEcl * DEG;
  const latR = latEcl * DEG;

  const ra =
    Math.atan2(
      Math.sin(lonR) * Math.cos(eps) - Math.tan(latR) * Math.sin(eps),
      Math.cos(lonR)
    ) * RAD;
  const dec =
    Math.asin(
      Math.sin(latR) * Math.cos(eps) + Math.cos(latR) * Math.sin(eps) * Math.sin(lonR)
    ) * RAD;
  const raN = normalize360(ra);

  const gmst =
    normalize360(
      280.46061837 +
        360.98564736629 * (jd - 2451545) +
        0.000387933 * T * T -
        (T * T * T) / 38710000
    );
  const lst = normalize360(gmst + lon);
  const ha = normalize180(lst - raN);

  const latRad = lat * DEG;
  const decRad = dec * DEG;
  const haRad = ha * DEG;

  const sinAlt =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const altitude = Math.asin(Math.min(1, Math.max(-1, sinAlt))) * RAD;

  const y = -Math.sin(haRad);
  const x =
    Math.tan(decRad) * Math.cos(latRad) -
    Math.sin(latRad) * Math.cos(haRad);
  let azimuth = normalize360(Math.atan2(y, x) * RAD);

  const sun = sunPosition(lat, lon, d);
  let elong = normalize360(lonEcl - sun.eclipticLongitude);
  // 相位角：0 新月、180 滿月（用 0～180 的 elong）
  let phaseAngle = elong;
  if (phaseAngle > 180) phaseAngle = 360 - phaseAngle;
  // 照亮比例 0～100%
  const illumination = round4(0.5 * (1 - Math.cos(phaseAngle * DEG)) * 100);

  // 盈虧方向：月亮黃經相對太陽
  let waxing = normalize360(lonEcl - sun.eclipticLongitude);
  if (waxing > 180) waxing = waxing - 360;
  const isWaxing = waxing >= 0;

  let phaseLabel = "盈凸月";
  if (phaseAngle < 22.5) phaseLabel = "新月";
  else if (phaseAngle < 67.5) phaseLabel = isWaxing ? "蛾眉月" : "殘月";
  else if (phaseAngle < 112.5) phaseLabel = isWaxing ? "上弦月" : "下弦月";
  else if (phaseAngle < 157.5) phaseLabel = isWaxing ? "盈凸月" : "虧凸月";
  else phaseLabel = "滿月";

  const angularDiameterArcmin = round4((1738 / dist) * ((180 * 60) / Math.PI));

  return {
    body: "moon",
    altitude: round4(altitude),
    altitudeApparent: round4(altitude),
    azimuth: round4(azimuth),
    azimuthFromNorth: round4(azimuth),
    rightAscension: round4(raN),
    declination: round4(dec),
    hourAngle: round4(ha),
    eclipticLongitude: round4(lonEcl),
    eclipticLatitude: round4(latEcl),
    distanceKm: Math.round(dist),
    illuminationPercent: illumination,
    illumination: round4(illumination / 100),
    phaseAngle: round4(phaseAngle),
    phaseLabel,
    isWaxing,
    angularDiameterArcmin,
    isUp: altitude > 0,
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function computeSkyPosition(opts) {
  const lat = Number(opts.lat);
  const lon = Number(opts.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, reason: "invalid-lat-lon" };
  }
  const time = opts.time ? new Date(opts.time) : new Date();
  if (Number.isNaN(time.getTime())) {
    return { ok: false, reason: "invalid-time" };
  }

  const sun = sunPosition(lat, lon, time);
  const moon = moonPosition(lat, lon, time);

  return {
    ok: true,
    source: "computed",
    algorithm: "meeus-simplified",
    observer: {
      lat,
      lon,
      time: time.toISOString(),
      timeLocalHint: "傳入 ISO 字串；未傳則用伺服器當下 UTC",
    },
    units: {
      angle: "degree",
      azimuth: "from geographic north, clockwise 0–360",
      altitude: "horizon 0, zenith 90, negative = below horizon",
      distanceSun: "AU",
      distanceMoon: "km",
      illumination: "percent 0–100 of moon disk lit",
    },
    sun,
    moon,
    summary: {
      sunAltitude: sun.altitudeApparent,
      sunAzimuth: sun.azimuth,
      moonAltitude: moon.altitude,
      moonAzimuth: moon.azimuth,
      moonPhase: moon.phaseLabel,
      moonIllumination: moon.illuminationPercent,
      moonIlluminationFraction: moon.illumination,
      sunUp: sun.isUp,
      moonUp: moon.isUp,
    },
  };
}

/** 專用：月球照亮面積（百分比與 0～1） */
function computeMoonIllumination(opts) {
  const sky = computeSkyPosition(opts);
  if (!sky.ok) return sky;
  const m = sky.moon;
  return {
    ok: true,
    source: "computed",
    algorithm: "meeus-simplified",
    time: sky.observer.time,
    observer: sky.observer,
    illuminationPercent: m.illuminationPercent,
    illumination: m.illumination,
    phaseAngle: m.phaseAngle,
    phaseLabel: m.phaseLabel,
    isWaxing: m.isWaxing,
    moonAltitude: m.altitude,
    moonAzimuth: m.azimuth,
    distanceKm: m.distanceKm,
    angularDiameterArcmin: m.angularDiameterArcmin,
    isUp: m.isUp,
    units: {
      illuminationPercent: "0–100，月球視盤被太陽照亮的比例",
      illumination: "0–1，同上",
      phaseAngle: "degree，0 新月、90 上下弦、180 滿月",
    },
  };
}

module.exports = {
  computeSkyPosition,
  computeMoonIllumination,
  sunPosition,
  moonPosition,
};
