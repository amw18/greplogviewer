// KeywordTimeline — 底部面板的时间线图表，显示各 keyword 在时间轴上的分布
import * as vscode from 'vscode';
import { TimelineDataMessage, TimelineClickMessage } from '../types';

export class KeywordTimeline implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private clickCallback: ((lineNumber: number) => void) | undefined;
  private lastData: import('../types').TimelineDataMessage | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: TimelineClickMessage) => {
      if (msg.type === 'timelineClick') {
        this.clickCallback?.(msg.lineNumber);
      }
    });
  }

  onDidClick(callback: (lineNumber: number) => void): void {
    this.clickCallback = callback;
  }

  /** 发送时间线数据到 webview */
  sendTimelineData(data: TimelineDataMessage): void {
    this.lastData = data;
    this.view?.webview.postMessage(data);
  }

  /** 获取最近一次发送的时间线数据（供测试使用） */
  getLastTimelineData(): import('../types').TimelineDataMessage | undefined {
    return this.lastData;
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body { font-family: var(--vscode-font-family, monospace); font-size: 10px;
         color: var(--vscode-foreground); background: var(--vscode-editor-background);
         overflow: hidden; user-select: none; }
  canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
  .tooltip { display: none; position: fixed; z-index: 9999;
    background: var(--vscode-editorHoverWidget-background);
    color: var(--vscode-editorHoverWidget-foreground);
    border: 1px solid var(--vscode-editorHoverWidget-border);
    padding: 2px 5px; border-radius: 3px; font-size: 11px;
    pointer-events: none; white-space: nowrap; }
  .empty { display: flex; align-items: center; justify-content: center;
    height: 100%; color: var(--vscode-descriptionForeground); font-size: 11px; }
  .zoom-indicator { display: none; position: absolute; top: 1px; left: 105px; right: 50px;
    height: 3px; opacity: 0.5; pointer-events: none; z-index: 10; }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="zoom-indicator" class="zoom-indicator"></div>
<div id="tooltip" class="tooltip"></div>
<div id="empty" class="empty">Click Go with Time Pattern + Keywords to see timeline</div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById('canvas');
  const tooltip = document.getElementById('tooltip');
  const empty = document.getElementById('empty');
  const ctx = canvas.getContext('2d');

  let data = null;
  let viewMin = null;
  let viewMax = null;
  let drawRAF = null;  // requestAnimationFrame 节流，合并同帧多次 draw
  const MIN_ZOOM_MS = 1000;
  let PAD = { top: 4, right: 50, bottom: 20, left: 105 };
  const DOT_R = 3.5;
  const ROW_H = 14;
  const ROW_GAP = 1;

  let lastW = 0, lastH = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    // 让 CSS 决定 canvas 在容器中的大小，我们只同步 drawing buffer 分辨率
    const w = Math.max(1, canvas.clientWidth || document.documentElement.clientWidth);
    const h = Math.max(1, canvas.clientHeight || document.documentElement.clientHeight);
    lastW = w;
    lastH = h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (data && data.keywords.length > 0) { scheduleDraw(); }
  }

  // VS Code webview 在面板拖动时不会稳定触发 resize/ResizeObserver，使用轮询兜底
  function pollSize() {
    const w = canvas.clientWidth || document.documentElement.clientWidth;
    const h = canvas.clientHeight || document.documentElement.clientHeight;
    if (w !== lastW || h !== lastH) { resize(); }
  }
  setInterval(pollSize, 100);

  /** 解析 VS Code CSS 变量为实际字体，供 Canvas 使用 */
  function getCanvasFont(size, fallback) {
    const family = getComputedStyle(document.body).getPropertyValue('--vscode-font-family').trim() || fallback || 'monospace';
    return size + ' ' + family;
  }

  /** 根据当前 keyword 标签的最大宽度动态计算左侧第 0 列宽度 */
  function updateLabelColumnWidth() {
    if (!data || data.keywords.length === 0) { return; }
    ctx.font = getCanvasFont('9px', 'monospace');
    let maxW = 0;
    for (const kw of data.keywords) {
      const labelText = kw.name.length > 16 ? kw.name.slice(0, 15) + '…' : kw.name;
      const w = ctx.measureText(labelText).width;
      if (w > maxW) { maxW = w; }
    }
    // 标签右对齐在 chartLeft - 6，因此需要预留 maxW + 6，再加 10px 边距
    PAD.left = Math.max(60, Math.ceil(maxW + 6 + 10));
  }

  // ── Zoom ──
  function resetView() {
    if (!data) { return; }
    viewMin = data.timeMin;
    viewMax = data.timeMax;
  }

  function zoomAt(mouseX, factor) {
    if (!data) { return; }
    const chartLeft = PAD.left;
    const chartRight = canvas.clientWidth - PAD.right;
    const chartW = chartRight - chartLeft;
    const frac = Math.max(0, Math.min(1, (mouseX - chartLeft) / chartW));
    const mouseTime = viewMin + frac * (viewMax - viewMin);
    const half = (viewMax - viewMin) * factor / 2;
    var newMin = mouseTime - half;
    var newMax = mouseTime + half;
    var span = newMax - newMin;
    if (span < MIN_ZOOM_MS) {
      var mid = (newMin + newMax) / 2;
      newMin = mid - MIN_ZOOM_MS / 2;
      newMax = mid + MIN_ZOOM_MS / 2;
      span = MIN_ZOOM_MS;
    }
    // 边界约束：超出时保持 span 不变
    if (newMin < data.timeMin) { newMin = data.timeMin; newMax = newMin + span; }
    if (newMax > data.timeMax) { newMax = data.timeMax; newMin = newMax - span; }
    // 最终兜底
    viewMin = Math.max(data.timeMin, newMin);
    viewMax = Math.min(data.timeMax, Math.max(viewMin + MIN_ZOOM_MS, newMax));
    scheduleDraw();
  }

  function fmtOffset(ms) {
    if (ms < 0) return '0';
    if (ms < 1000) return Math.round(ms) + 'ms';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    var m = Math.floor(s / 60);
    var rs = Math.round(s % 60);
    if (m < 60) return m + 'm ' + rs + 's';
    var h = Math.floor(m / 60);
    var rm = Math.round(m % 60);
    if (h < 24) return h + 'h ' + rm + 'm';
    var d = Math.floor(h / 24);
    return d + 'd ' + Math.round(h % 24) + 'h';
  }

  function fmtFull(ms) {
    return '+' + fmtOffset(ms);
  }

  function fmtTick(ms) {
    return fmtOffset(ms);
  }

  function smartTickCount(chartW) {
    // ~10 等分时间轴，最少 2 个 tick，最多不超过每 30px 一个
    const maxTicks = Math.max(2, Math.floor(chartW / 30));
    return Math.max(2, Math.min(10, maxTicks));
  }

  function scheduleDraw() {
    if (drawRAF) { return; }
    drawRAF = requestAnimationFrame(function() {
      drawRAF = null;
      draw();
    });
  }

  function draw() {
    if (!data || data.keywords.length === 0) { return; }
    if (viewMin === null) { resetView(); }
    updateLabelColumnWidth();
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    empty.style.display = 'none';
    canvas.style.display = 'block';

    const kwCount = data.keywords.length;
    const chartLeft = PAD.left;
    const chartRight = W - PAD.right;
    const chartW = chartRight - chartLeft;
    const timeRange = viewMax - viewMin || 1;

    // BG
    const bodyStyle = getComputedStyle(document.body);
    ctx.fillStyle = bodyStyle.backgroundColor || '#1e1e1e';
    ctx.fillRect(0, 0, W, H);

    const axisColor = bodyStyle.getPropertyValue('--vscode-descriptionForeground') || '#999999';
    const gridColor = bodyStyle.backgroundColor
      ? 'rgba(128,128,128,0.35)' : 'rgba(180,180,180,0.3)';
    // Grid, sub-grid & time labels
    const chartBottom = PAD.top + kwCount * (ROW_H + ROW_GAP) - ROW_GAP;
    const tickCount = smartTickCount(chartW);
    for (let t = 0; t <= tickCount; t++) {
      const frac = t / tickCount;
      const x = chartLeft + frac * chartW;

      // Major grid
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, chartBottom);
      ctx.strokeStyle = gridColor;
      ctx.stroke();

      // Sub-grid (every 5 sub-ticks between majors)
      if (t < tickCount && chartW / tickCount > 40) {
        for (let s = 1; s <= 4; s++) {
          const sx = x + (s / 5) * (chartW / tickCount);
          ctx.beginPath();
          ctx.moveTo(sx, PAD.top);
          ctx.lineTo(sx, chartBottom);
          ctx.strokeStyle = 'rgba(128,128,128,0.12)';
          ctx.stroke();
        }
      }

      // Label — 相对时间差
      const ts = viewMin + frac * timeRange;
      ctx.fillStyle = axisColor;
      ctx.textAlign = 'center';
      ctx.font = getCanvasFont('8px', 'monospace');
      ctx.fillText(fmtTick(ts - data.timeMin), x, chartBottom + 13);
    }

    // Keywords rows
    for (let k = 0; k < kwCount; k++) {
      const kw = data.keywords[k];
      const yTop = PAD.top + k * (ROW_H + ROW_GAP);
      const yMid = yTop + ROW_H / 2;

      // Label (truncated)
      ctx.fillStyle = kw.color;
      ctx.textAlign = 'right';
      ctx.font = getCanvasFont('9px', 'monospace');
      const labelText = kw.name.length > 16 ? kw.name.slice(0, 15) + '…' : kw.name;
      ctx.fillText(labelText, chartLeft - 6, yMid + 3);

      // Row bg
      ctx.fillStyle = 'rgba(128,128,128,0.03)';
      ctx.fillRect(chartLeft, yTop, chartW, ROW_H);

      // Dots (batch same x positions to reduce overlap noise is OK)
      for (const pt of kw.points) {
        if (pt.time < viewMin || pt.time > viewMax) { continue; }
        const frac = (pt.time - viewMin) / timeRange;
        const x = chartLeft + frac * chartW;

        ctx.beginPath();
        ctx.arc(x, yMid, DOT_R, 0, Math.PI * 2);
        ctx.fillStyle = kw.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // Zoom indicator bar
    const indicator = document.getElementById('zoom-indicator');
    if (indicator && data.timeMax > data.timeMin) {
      const totalMs = data.timeMax - data.timeMin;
      const leftFrac = (viewMin - data.timeMin) / totalMs;
      const widthFrac = (viewMax - viewMin) / totalMs;
      indicator.style.display = (widthFrac >= 0.99) ? 'none' : 'block';
      indicator.style.left = (chartLeft + leftFrac * chartW) + 'px';
      indicator.style.width = Math.max(4, widthFrac * chartW) + 'px';
      indicator.style.background = axisColor;
    }
  }

  function pointAt(px, py) {
    if (!data) { return null; }
    const W = canvas.clientWidth;
    const kwCount = data.keywords.length;
    const chartLeft = PAD.left;
    const chartRight = W - PAD.right;
    const chartW = chartRight - chartLeft;
    const timeRange = viewMax - viewMin || 1;

    for (let k = 0; k < kwCount; k++) {
      const kw = data.keywords[k];
      const yMid = PAD.top + k * (ROW_H + ROW_GAP) + ROW_H / 2;

      for (const pt of kw.points) {
        if (pt.time < viewMin || pt.time > viewMax) { continue; }
        const frac = (pt.time - viewMin) / timeRange;
        const x = chartLeft + frac * chartW;
        const dx = px - x;
        const dy = py - yMid;
        if (dx * dx + dy * dy <= DOT_R * DOT_R + 12) {
          return { point: pt, keyword: kw };
        }
      }
    }
    return null;
  }

  canvas.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    const hit = pointAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      canvas.style.cursor = 'pointer';
      tooltip.style.display = 'block';
      var tx = e.clientX + 12;
      var ty = e.clientY - 28;
      // 边界约束：不超出视口
      var tw = tooltip.offsetWidth || 220;
      if (tx + tw > canvas.clientWidth - 4) { tx = canvas.clientWidth - tw - 4; }
      if (ty < 4) { ty = e.clientY + 10; }
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
      tooltip.textContent = hit.keyword.name + '  +' + fmtOffset(hit.point.time - data.timeMin)
        + '  (L' + (hit.point.lineNumber + 1) + ')';
    } else {
      canvas.style.cursor = 'crosshair';
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('click', function(e) {
    const rect = canvas.getBoundingClientRect();
    const hit = pointAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      vscode.postMessage({ type: 'timelineClick', lineNumber: hit.point.lineNumber });
    }
  });

  canvas.addEventListener('mouseleave', function() {
    tooltip.style.display = 'none';
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (!data) { return; }
    // deltaY > 0 → zoom out, deltaY < 0 → zoom in
    const factor = e.deltaY > 0 ? 1.5 : 0.67;
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, factor);
  }, { passive: false });

  window.addEventListener('resize', resize);
  // canvas 由 CSS 控制大小，监听 canvas 尺寸变化比 window/根元素更可靠
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(function() { resize(); });
    ro.observe(canvas);
  }

  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'timelineData') {
      data = msg;
      resetView();
      if (data.keywords.length > 0) {
        empty.style.display = 'none';
        canvas.style.display = 'block';
        draw();
      } else {
        empty.style.display = 'flex';
        canvas.style.display = 'none';
      }
    }
  });

  resize();
})();
</script>
</body>
</html>`;
  }
}
