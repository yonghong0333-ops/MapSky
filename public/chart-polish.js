/* chart-polish.js — override renderChart with smoother, denser look */
(function () {
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

  window.renderChart = function renderChart(wx, minT, maxT) {
    var canvas = elLocal("tempChart");
    if (!canvas || !wx || !minT || !maxT) return;
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 360;
    var cssH = 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = cssW, H = cssH;
    var padL = 36, padR = 16, padT = 28, padB = 32;
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
    var gridLines = 4;
    for (var g = 0; g <= gridLines; g++) {
      var v = minV + ((maxV - minV) / gridLines) * g;
      var y = toY(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(Math.round(v) + "°", padL - 6, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#64748b";
    for (var i = 0; i < n; i++) {
      var lab = labels[i] || "";
      if (lab.length > 8 && n >= 3) {
        lab = lab.replace("白天", "日").replace("傍晚", "晚").replace("晚上", "夜");
      }
      ctx.fillText(lab, toX(i), H - padB + 10);
    }

    function smoothLine(values) {
      if (values.length === 1) {
        ctx.lineTo(toX(0), toY(values[0]));
        return;
      }
      ctx.moveTo(toX(0), toY(values[0]));
      for (var i = 0; i < values.length - 1; i++) {
        var x0 = toX(i), y0 = toY(values[i]);
        var x1 = toX(i + 1), y1 = toY(values[i + 1]);
        var cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
      }
    }

    // band between max & min
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

    function drawLine(values, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      smoothLine(values);
      ctx.stroke();
      values.forEach(function (v, i) {
        var x = toX(i), y = toY(v);
        ctx.beginPath();
        ctx.fillStyle = "#fff";
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    drawLine(tmax.slice(0, n), "#f97316");
    drawLine(tmin.slice(0, n), "#0ea5e9");

    ctx.font = "600 11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    for (var k = 0; k < n; k++) {
      ctx.fillStyle = "#c2410c";
      ctx.textBaseline = "bottom";
      ctx.fillText(Math.round(tmax[k]) + "°", toX(k), toY(tmax[k]) - 8);
      ctx.fillStyle = "#0369a1";
      ctx.textBaseline = "top";
      ctx.fillText(Math.round(tmin[k]) + "°", toX(k), toY(tmin[k]) + 8);
    }

    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(padL, 12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.fillText("最高溫", padL + 10, 12);
    ctx.fillStyle = "#0ea5e9";
    ctx.beginPath();
    ctx.arc(padL + 72, 12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.fillText("最低溫", padL + 82, 12);
  };

  // If weather already rendered, redraw once DOM ready
  function tryRedraw() {
    // no-op: next city refresh will use new renderChart
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryRedraw);
  }
})();
