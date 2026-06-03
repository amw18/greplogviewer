// KeywordTimeline — 底部面板的时间线图表，显示各 keyword 在时间轴上的分布
import * as vscode from 'vscode';
import { TimelineDataMessage, TimelineClickMessage } from '../types';

export class KeywordTimeline implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private clickCallback: ((lineNumber: number) => void) | undefined;

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
    this.view?.webview.postMessage(data);
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, monospace); font-size: 10px;
         color: var(--vscode-foreground); background: var(--vscode-editor-background);
         overflow: hidden; user-select: none; }
  canvas { display: block; cursor: crosshair; }
  .tooltip { display: none; position: fixed; z-index: 9999;
    background: var(--vscode-editorHoverWidget-background);
    color: var(--vscode-editorHoverWidget-foreground);
    border: 1px solid var(--vscode-editorHoverWidget-border);
    padding: 2px 5px; border-radius: 3px; font-size: 11px;
    pointer-events: none; white-space: nowrap; }
  .empty { display: flex; align-items: center; justify-content: center;
    height: 100%; color: var(--vscode-descriptionForeground); font-size: 11px; }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
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
  const PAD = { top: 4, right: 10, bottom: 20, left: 105 };
  const DOT_R = 3.5;
  const ROW_H = 14;
  const ROW_GAP = 1;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (data && data.keywords.length > 0) { draw(); }
  }

  function fmtFull(ms) {
    const d = new Date(ms);
    const pad = (n, l) => String(n).padStart(l, '0');
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':'
      + pad(d.getSeconds(), 2) + '.' + pad(d.getMilliseconds(), 3);
  }

  function fmtTick(ms) {
    const d = new Date(ms);
    const pad = (n, l) => String(n).padStart(l, '0');
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':'
      + pad(d.getSeconds(), 2);
  }

  function smartTickCount(chartW) {
    // ~10 等分时间轴，最少 2 个 tick，最多不超过每 30px 一个
    const maxTicks = Math.max(2, Math.floor(chartW / 30));
    return Math.max(2, Math.min(10, maxTicks));
  }

  function draw() {
    if (!data || data.keywords.length === 0) { return; }
    const W = window.innerWidth;
    const H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    empty.style.display = 'none';
    canvas.style.display = 'block';

    const kwCount = data.keywords.length;
    const chartLeft = PAD.left;
    const chartRight = W - PAD.right;
    const chartW = chartRight - chartLeft;
    const timeRange = data.timeMax - data.timeMin || 1;

    // BG
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background') || '#1e1e1e';
    ctx.fillRect(0, 0, W, H);

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
      ctx.strokeStyle = 'rgba(128,128,128,0.2)';
      ctx.stroke();

      // Sub-grid (every 5 sub-ticks between majors)
      if (t < tickCount && chartW / tickCount > 40) {
        for (let s = 1; s <= 4; s++) {
          const sx = x + (s / 5) * (chartW / tickCount);
          ctx.beginPath();
          ctx.moveTo(sx, PAD.top);
          ctx.lineTo(sx, chartBottom);
          ctx.strokeStyle = 'rgba(128,128,128,0.06)';
          ctx.stroke();
        }
      }

      // Label
      const ts = data.timeMin + frac * timeRange;
      ctx.fillStyle = 'var(--vscode-descriptionForeground)';
      ctx.textAlign = 'center';
      ctx.font = '8px var(--vscode-font-family, monospace)';
      ctx.fillText(fmtTick(ts), x, chartBottom + 13);
    }

    // Keywords rows
    for (let k = 0; k < kwCount; k++) {
      const kw = data.keywords[k];
      const yTop = PAD.top + k * (ROW_H + ROW_GAP);
      const yMid = yTop + ROW_H / 2;

      // Label (truncated)
      ctx.fillStyle = kw.color;
      ctx.textAlign = 'right';
      ctx.font = '9px var(--vscode-font-family, monospace)';
      const labelText = kw.name.length > 16 ? kw.name.slice(0, 15) + '…' : kw.name;
      ctx.fillText(labelText, chartLeft - 6, yMid + 3);

      // Row bg
      ctx.fillStyle = 'rgba(128,128,128,0.03)';
      ctx.fillRect(chartLeft, yTop, chartW, ROW_H);

      // Dots (batch same x positions to reduce overlap noise is OK)
      for (const pt of kw.points) {
        if (pt.time < data.timeMin || pt.time > data.timeMax) { continue; }
        const frac = (pt.time - data.timeMin) / timeRange;
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
  }

  function pointAt(px, py) {
    if (!data) { return null; }
    const W = window.innerWidth;
    const kwCount = data.keywords.length;
    const chartLeft = PAD.left;
    const chartRight = W - PAD.right;
    const chartW = chartRight - chartLeft;
    const timeRange = data.timeMax - data.timeMin || 1;

    for (let k = 0; k < kwCount; k++) {
      const kw = data.keywords[k];
      const yMid = PAD.top + k * (ROW_H + ROW_GAP) + ROW_H / 2;

      for (const pt of kw.points) {
        if (pt.time < data.timeMin || pt.time > data.timeMax) { continue; }
        const frac = (pt.time - data.timeMin) / timeRange;
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
    const hit = pointAt(e.clientX, e.clientY);
    if (hit) {
      canvas.style.cursor = 'pointer';
      tooltip.style.display = 'block';
      var tx = e.clientX + 12;
      var ty = e.clientY - 28;
      // 边界约束：不超出视口
      var tw = tooltip.offsetWidth || 220;
      if (tx + tw > window.innerWidth - 4) { tx = window.innerWidth - tw - 4; }
      if (ty < 4) { ty = e.clientY + 10; }
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
      tooltip.textContent = hit.keyword.name + '  @  ' + fmtFull(hit.point.time)
        + '  (L' + (hit.point.lineNumber + 1) + ')';
    } else {
      canvas.style.cursor = 'crosshair';
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('click', function(e) {
    const hit = pointAt(e.clientX, e.clientY);
    if (hit) {
      vscode.postMessage({ type: 'timelineClick', lineNumber: hit.point.lineNumber });
    }
  });

  canvas.addEventListener('mouseleave', function() {
    tooltip.style.display = 'none';
  });

  window.addEventListener('resize', resize);

  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'timelineData') {
      data = msg;
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
