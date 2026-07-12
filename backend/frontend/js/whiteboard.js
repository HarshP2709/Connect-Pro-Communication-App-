/**
 * ConnectPro — Whiteboard JS
 * Full Canvas drawing with real-time sync
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  if (!Auth.requireAuth()) return;

  const canvas = document.getElementById('wb-canvas');
  const ctx = canvas.getContext('2d');
  const area = document.getElementById('canvas-area');

  // ─── State ──────────────────────────────────────────────
  const WB = {
    tool: 'pen',
    color: '#ffffff',
    size: 4,
    opacity: 1,
    drawing: false,
    startX: 0, startY: 0,
    lastX: 0, lastY: 0,
    paths: [],         // undo stack
    redoStack: [],
    snapshot: null,    // for shapes preview
    socket: null,
    meetingId: new URLSearchParams(window.location.search).get('meeting'),
  };

  // ─── Canvas Setup ────────────────────────────────────────
  function resizeCanvas() {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width  = area.clientWidth;
    canvas.height = area.clientHeight;
    ctx.putImageData(img, 0, 0);
    setContextStyle();
  }

  function setContextStyle() {
    ctx.lineWidth   = WB.size;
    ctx.strokeStyle = hexToRgba(WB.color, WB.opacity);
    ctx.fillStyle   = hexToRgba(WB.color, WB.opacity);
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ─── Tool Selection ──────────────────────────────────────
  document.querySelectorAll('.wb-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-tool').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      WB.tool = btn.dataset.tool;
      canvas.style.cursor = WB.tool === 'eraser' ? 'cell' : WB.tool === 'text' ? 'text' : 'crosshair';
      document.getElementById('wb-hint').textContent = getHint(WB.tool);
    });
  });

  // ─── Color Selection ─────────────────────────────────────
  document.querySelectorAll('.color-swatch[data-color]').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      WB.color = sw.dataset.color;
      setContextStyle();
    });
  });

  document.getElementById('custom-color')?.addEventListener('input', (e) => {
    WB.color = e.target.value;
    setContextStyle();
  });

  // ─── Stroke Size ─────────────────────────────────────────
  const sizeSlider = document.getElementById('stroke-size');
  sizeSlider?.addEventListener('input', () => {
    WB.size = parseInt(sizeSlider.value);
    document.getElementById('stroke-size-display').textContent = WB.size + 'px';
    setContextStyle();
  });

  document.getElementById('stroke-opacity')?.addEventListener('input', (e) => {
    WB.opacity = parseInt(e.target.value) / 100;
    setContextStyle();
  });

  // ─── Drawing Events ───────────────────────────────────────
  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches?.[0] || e;
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  };

  const onStart = (e) => {
    e.preventDefault();
    const { x, y } = getPos(e);
    WB.drawing = true;
    WB.startX  = x;
    WB.startY  = y;
    WB.lastX   = x;
    WB.lastY   = y;

    if (WB.tool === 'text') {
      drawText(x, y);
      return;
    }

    if (['line','rect','circle','arrow'].includes(WB.tool)) {
      WB.snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
    saveToUndo();
  };

  const onMove = (e) => {
    if (!WB.drawing) return;
    e.preventDefault();
    const { x, y } = getPos(e);

    if (WB.tool === 'pen' || WB.tool === 'brush') {
      ctx.lineWidth = WB.tool === 'brush' ? WB.size * 3 : WB.size;
      ctx.globalAlpha = WB.opacity;
      ctx.lineTo(x, y);
      ctx.stroke();
      if (WB.socket) WB.socket.emit('whiteboard-draw', { tool: WB.tool, x, y, lastX: WB.lastX, lastY: WB.lastY, color: WB.color, size: WB.size, opacity: WB.opacity });
    } else if (WB.tool === 'eraser') {
      ctx.clearRect(x - WB.size, y - WB.size, WB.size * 2, WB.size * 2);
    } else if (['line','rect','circle','arrow'].includes(WB.tool)) {
      ctx.putImageData(WB.snapshot, 0, 0);
      drawShape(WB.tool, WB.startX, WB.startY, x, y);
    }

    WB.lastX = x;
    WB.lastY = y;
  };

  const onEnd = (e) => {
    WB.drawing = false;
    if (WB.snapshot) WB.snapshot = null;
    ctx.beginPath();
  };

  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onEnd);
  canvas.addEventListener('mouseleave', onEnd);
  canvas.addEventListener('touchstart', onStart, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onEnd);

  // ─── Shape Drawing ────────────────────────────────────────
  function drawShape(tool, x1, y1, x2, y2) {
    ctx.beginPath();
    if (tool === 'line') {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else if (tool === 'rect') {
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (tool === 'circle') {
      const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
      ctx.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (tool === 'arrow') {
      drawArrow(x1, y1, x2, y2);
    }
  }

  function drawArrow(x1, y1, x2, y2) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 20;
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  function drawText(x, y) {
    const input = document.createElement('input');
    input.style.cssText = `position:fixed;left:${x + canvas.getBoundingClientRect().left}px;top:${y + canvas.getBoundingClientRect().top}px;background:rgba(0,0,0,0.5);color:${WB.color};border:1px dashed ${WB.color};font-size:${WB.size * 4 + 8}px;outline:none;padding:4px 8px;min-width:150px;z-index:100`;
    document.body.appendChild(input);
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        if (input.value) {
          ctx.font = `${WB.size * 4 + 8}px Inter, sans-serif`;
          ctx.fillStyle = hexToRgba(WB.color, WB.opacity);
          ctx.fillText(input.value, x, y);
        }
        input.remove();
        WB.drawing = false;
      }
    });
    input.addEventListener('blur', () => {
      if (input.value) {
        ctx.font = `${WB.size * 4 + 8}px Inter, sans-serif`;
        ctx.fillStyle = hexToRgba(WB.color, WB.opacity);
        ctx.fillText(input.value, x, y);
      }
      input.remove();
      WB.drawing = false;
    });
  }

  // ─── Undo / Redo ─────────────────────────────────────────
  function saveToUndo() {
    WB.paths.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (WB.paths.length > 50) WB.paths.shift();
    WB.redoStack = [];
  }

  document.getElementById('wb-undo-btn')?.addEventListener('click', () => {
    if (WB.paths.length > 1) {
      WB.redoStack.push(WB.paths.pop());
      ctx.putImageData(WB.paths[WB.paths.length - 1], 0, 0);
      WB.socket?.emit('whiteboard-undo');
    } else if (WB.paths.length === 1) {
      WB.redoStack.push(WB.paths.pop());
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  document.getElementById('wb-redo-btn')?.addEventListener('click', () => {
    if (WB.redoStack.length > 0) {
      const state = WB.redoStack.pop();
      WB.paths.push(state);
      ctx.putImageData(state, 0, 0);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') document.getElementById('wb-undo-btn').click();
    if (e.ctrlKey && e.key === 'y') document.getElementById('wb-redo-btn').click();
    if (e.key === 'p' || e.key === 'P') document.getElementById('tool-pen')?.click();
    if (e.key === 'e' || e.key === 'E') document.getElementById('tool-eraser')?.click();
    if (e.key === 't' || e.key === 'T') document.getElementById('tool-text')?.click();
  });

  // ─── Clear ───────────────────────────────────────────────
  document.getElementById('wb-clear-btn')?.addEventListener('click', () => {
    if (confirm('Clear the entire whiteboard?')) {
      saveToUndo();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      WB.socket?.emit('whiteboard-clear');
      Toast.info('Whiteboard cleared');
    }
  });

  // ─── Download PNG ────────────────────────────────────────
  document.getElementById('wb-download-btn')?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    Toast.success('Downloaded!');
  });

  // ─── Save to Supabase ─────────────────────────────────────
  document.getElementById('wb-save-btn')?.addEventListener('click', async () => {
    if (!WB.meetingId) return Toast.warning('No meeting linked');
    try {
      const res = await API.get(`/api/whiteboards/${WB.meetingId}`);
      const boardId = res?.data?.id;
      if (boardId) {
        await API.post(`/api/whiteboards/${boardId}/save`, { image_data: canvas.toDataURL('image/png') });
        Toast.success('Whiteboard saved!');
      }
    } catch (err) {
      Toast.error('Save failed', err.message);
    }
  });

  // ─── Socket.io Sync ──────────────────────────────────────
  if (WB.meetingId) {
    WB.socket = io(CONFIG.BACKEND_URL, { auth: { token: API.token } });
    WB.socket.on('connect', () => {
      document.getElementById('wb-sync-status').textContent = '● Live Sync';
      document.getElementById('wb-sync-status').style.color = '#4ade80';
    });
    WB.socket.on('disconnect', () => {
      document.getElementById('wb-sync-status').textContent = '○ Offline';
      document.getElementById('wb-sync-status').style.color = 'rgba(255,255,255,0.3)';
    });
    WB.socket.on('whiteboard-draw', (data) => {
      if (!data) return;
      ctx.strokeStyle = hexToRgba(data.color, data.opacity);
      ctx.lineWidth   = data.size;
      ctx.beginPath();
      ctx.moveTo(data.lastX, data.lastY);
      ctx.lineTo(data.x, data.y);
      ctx.stroke();
    });
    WB.socket.on('whiteboard-clear', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    WB.socket.on('whiteboard-undo', () => {
      if (WB.paths.length > 0) {
        WB.paths.pop();
        if (WB.paths.length > 0) ctx.putImageData(WB.paths[WB.paths.length - 1], 0, 0);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
  }

  // ─── Utils ───────────────────────────────────────────────
  function hexToRgba(hex, opacity = 1) {
    const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }

  function getHint(tool) {
    const hints = { pen: 'Draw freely', brush: 'Thick brush strokes', eraser: 'Erase pixels', line: 'Draw straight line', rect: 'Draw rectangle', circle: 'Draw circle/ellipse', arrow: 'Draw arrow', text: 'Click to add text', select: 'Select elements' };
    return hints[tool] || '';
  }

  // Initial save point
  WB.paths.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  document.getElementById('wb-hint').textContent = getHint('pen');
  setContextStyle();
});
