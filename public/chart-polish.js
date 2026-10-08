/* chart-polish.js — interactive temperature trend chart */
(function () {
  var lastArgs = null;
  var hitMax = [];
  var hitMin = [];
  var activeIdx = -1;
  var activeKind = null;
  var tooltipEl = null;

  function formatPeriodLabelLocal(startTimeStr) {
    if (typeof formatPeriodLabel === "function") return formatPeriodLabel(startTimeStr);
    var d = new Date(String(startTimeStr).replace(" ", "T"));
    var hour = d.getHours();
    var dayNight = hour < 12 ? "白天" : hour < 18 ? "傍晚" : "晚上";
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + dayNight;
  }

  function elLocal(id) {
    if (typeof el === "function") return el(id);
    return document.getElementById(id);
  }

  function ensureTooltip() {
    if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.id = "tempChartTooltip";
    tooltipEl.setAttribute("role", "status");
    tooltipEl.style.cssText = [
      "position:absolute",
      "z-index:20",
      "pointer-events:none",
      "padding:8px 12px",
      "border-radius:12px",
      "font:600 13px -apple-system,BlinkMacSystemFont,sans-serif",
      "color:#0f172a",
      "background:rgba(255,255,255,0.92)",
      "border:1px solid rgba(56,189,248,0.45)",
      "box-shadow:0 8px 24px rgba(14,165,233,0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
      "backdrop-filter:blur(16px)",
      "-webkit-backdrop-filter:blur(16px)",
      "opacity:0",
      "transform:translate(-50%,-120%) scale(0.92)",
      "transition:opacity .18s ease, transform .18s ease",
      "white-space:nowrap",
      "display:none"
    ].join(";");
    return tooltipEl;
  }

  function showTooltip(canvas, x, y, html) {
    var tip = ensureTooltip();
    var parent = canvas.parentElement || document.body;
    if (tip.parentElement !== parent) {
      if (!parent.style.position || parent.style.position === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(tip);
    }
    tip.innerHTML = html;
    tip.style.display = "block";
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    requestAnimationFrame(function () {
      tip.style.opacity = "1";
      tip.style.transform = "translate(-50%,-120%) scale(1)";
    });
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.style.opacity = "0";
    tooltipEl.style.transform = "translate(-50%,-120%) scale(0.92)";
    setTimeout(function () {
      if (tooltipEl) tooltipEl.style.display = "none";
    }, 180);
  }

  function drawChart(wx, minT, maxT) {
    var canvas = elLocal("tempChart");
    if (!canvas || !wx || !minT || !maxT) return;
    lastArgs = { wx: wx, minT: minT, maxT: maxT };

    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 360;
    var cssH = 240;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    canvas.style.touchAction = "manipulation";
    canvas.style.cursor = "pointer";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = cssW, H = cssH;
    var padL = 36, padR = 16, padT = 32, padB = 36;
    ctx.clearRect(0, 0, W, H);

    var periods = wx.time.length;
    if (periods === 0) return;

    var labels = wx.time.map(function (t) { return formatPeriodLabelLocal(t.startTime); });
    var tmax = maxT.time.map(function (t) { return parseFloat(t.parameter.parameterName); });
    var tmin = minT.time.map(function (t) { return parseFloat(t.parameter.parameterName); });
    var n = Math.min(periods, tmax.length, tmin.length, labels.length);
    if (n < 1) return;

    var allVals = tmax.slice(0, n).concat(tmin.slice(0, n));
    var maxV = Math.ceil(Math.max.apply(null, allVals) + 1);
    var minV = Math.floor(Math.min.apply(null, allVals) - 1);
    if (maxV - minV < 6) {
      var mid = (maxV + minV) / 2;
      maxV = Math.ceil(mid + 3);
      minV = Math.floor(mid - 3);
    }
    var xStep = n === 1 ? 0 : (W - padL - padR) / (n - 1);
    var yScale = (H - padT - padB) / (maxV - minV || 1);
    function toX(i) { return padL + i * xStep; }
    function toY(v) { return H - padB - (v - minV) * yScale; }

    ctx.strokeStyle = "rgba(14, 165, 233, 0.12)";
    ctx.fillStyle = "#64748b";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var g = 0; g <= 4; g++) {
      var gv = minV + ((maxV - minV) / 4) * g;
      var gy = toY(gv);
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(W - padR, gy);
      ctx.stroke();
      ctx.fillText(Math.round(gv) + "°", padL - 6, gy);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#64748b";
    for (var i = 0; i < n; i++) {
      var lab = labels[i] || "";
      if (lab.length > 8 && n >= 3) {
        lab = lab.replace("白天", "日").replace("傍晚", "晚").replace("晚上", "夜");
      }
      ctx.fillText(lab, toX(i), H - padB + 12);
    }

    function smoothLine(values) {
      if (values.length === 1) {
        ctx.lineTo(toX(0), toY(values[0]));
        return;
      }
      ctx.moveTo(toX(0), toY(values[0]));
      for (var si = 0; si < values.length - 1; si++) {
        var x0 = toX(si), y0 = toY(values[si]);
        var x1 = toX(si + 1), y1 = toY(values[si + 1]);
        var cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
      }
    }

    ctx.beginPath();
    smoothLine(tmax.slice(0, n));
    for (var j = n - 1; j >= 0; j--) {
      if (j === n - 1) ctx.lineTo(toX(j), toY(tmin[j]));
      else {
        var bx0 = toX(j + 1), by0 = toY(tmin[j + 1]);
        var bx1 = toX(j), by1 = toY(tmin[j]);
        var bcx = (bx0 + bx1) / 2;
        ctx.bezierCurveTo(bcx, by0, bcx, by1, bx1, by1);
      }
    }
    ctx.closePath();
    var band = ctx.createLinearGradient(0, padT, 0, H - padB);
    band.addColorStop(0, "rgba(251, 146, 60, 0.18)");
    band.addColorStop(1, "rgba(56, 189, 248, 0.14)");
    ctx.fillStyle = band;
    ctx.fill();

    function drawLine(values, color, kind) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      smoothLine(values);
      ctx.stroke();

      var hits = [];
      values.forEach(function (v, idx) {
        var x = toX(idx), y = toY(v);
        var isActive = activeIdx === idx && activeKind === kind;
        var r = isActive ? 8 : 5;

        if (isActive) {
          ctx.beginPath();
          ctx.fillStyle = kind === "max" ? "rgba(249,115,22,0.22)" : "rgba(14,165,233,0.22)";
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.fillStyle = "#fff";
        ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        hits.push({ i: idx, x: x, y: y, v: v, label: labels[idx], kind: kind, color: color });
      });
      return hits;
    }

    hitMax = drawLine(tmax.slice(0, n), "#f97316", "max");
    hitMin = drawLine(tmin.slice(0, n), "#0ea5e9", "min");

    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(padL, 14, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.fillText("最高溫", padL + 10, 14);
    ctx.fillStyle = "#0ea5e9";
    ctx.beginPath();
    ctx.arc(padL + 72, 14, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.fillText("最低溫", padL + 82, 14);

    if (activeIdx < 0) {
      ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "right";
      ctx.fillText("點節點查看", W - padR, 14);
    }

    bindCanvas(canvas);
  }

  function findHit(cx, cy) {
    var best = null;
    var bestD = 28;
    function test(list) {
      for (var i = 0; i < list.length; i++) {
        var h = list[i];
        var d = Math.hypot(h.x - cx, h.y - cy);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
    }
    test(hitMax);
    test(hitMin);
    return best;
  }

  function onPointer(e) {
    var canvas = elLocal("tempChart");
    if (!canvas || !lastArgs) return;
    var rect = canvas.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    var cx = ((t.clientX - rect.left) / rect.width) * (canvas.clientWidth || rect.width);
    var cy = ((t.clientY - rect.top) / rect.height) * (canvas.clientHeight || rect.height);
    var hit = findHit(cx, cy);
    if (!hit) {
      activeIdx = -1;
      activeKind = null;
      hideTooltip();
      drawChart(lastArgs.wx, lastArgs.minT, lastArgs.maxT);
      return;
    }
    activeIdx = hit.i;
    activeKind = hit.kind;
    drawChart(lastArgs.wx, lastArgs.minT, lastArgs.maxT);

    var title = hit.kind === "max" ? "最高溫" : "最低溫";
    var html =
      '<div style="font-size:12px;color:#64748b;margin-bottom:2px">' +
      hit.label +
      "</div>" +
      '<div style="font-size:16px;font-weight:800;color:' +
      hit.color +
      '">' +
      title +
      " " +
      Math.round(hit.v) +
      "°C</div>";

    showTooltip(canvas, hit.x, hit.y, html);

    try {
      if (navigator.vibrate) navigator.vibrate(8);
    } catch (err) {}
  }

  function bindCanvas(canvas) {
    if (canvas.dataset.chartInteractive === "1") return;
    canvas.dataset.chartInteractive = "1";
    canvas.addEventListener("pointerdown", onPointer, { passive: true });
    canvas.addEventListener("click", onPointer, { passive: true });
  }

  function install() {
    window.renderChart = function (wx, minT, maxT) {
      activeIdx = -1;
      activeKind = null;
      hideTooltip();
      drawChart(wx, minT, maxT);
    };

    var panel = elLocal("chartPanel");
    if (panel && !panel.dataset.chartWatch) {
      panel.dataset.chartWatch = "1";
      var obs = new MutationObserver(function () {
        if (panel.classList.contains("active") && lastArgs) {
          setTimeout(function () {
            drawChart(lastArgs.wx, lastArgs.minT, lastArgs.maxT);
          }, 40);
        }
      });
      obs.observe(panel, { attributes: true, attributeFilter: ["class"] });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(install, 200); });
  } else {
    setTimeout(install, 200);
  }
  // keep reinstalling briefly in case renderer.js loads later
  var n = 0;
  var timer = setInterval(function () {
    install();
    n += 1;
    if (n > 15) clearInterval(timer);
  }, 400);
})();
