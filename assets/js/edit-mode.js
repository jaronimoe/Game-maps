// Edit mode: drag markers, place items that have no position yet, read coordinates
// by clicking the map, and download the changed data files to commit back to the repo.

/* global L */
import { formatDataset } from './format.js';
import { copyText, esc } from './util.js';

function setDraggable(marker, on) {
  marker.options.draggable = on;
  if (marker.dragging) {
    if (on) marker.dragging.enable();
    else marker.dragging.disable();
  }
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createEditMode({ root, map, els, markers, toLatLng, fromLatLng, mapDefs, markerFor, refresh, getMapId }) {
  const dirty = new Set();
  let placing = null;

  function renderBar() {
    const hint = placing
      ? `Click the map to place <b>${esc(placing.raw.name)}</b> · <kbd>Esc</kbd> cancels`
      : 'Drag markers to move them · click the map to read coordinates';
    const downloads = [...dirty]
      .map((ds) => `<button type="button" class="gm-primary" data-download="${esc(ds.path)}">Download ${esc(ds.path.split('/').pop())}</button>`)
      .join('');
    els.editbar.innerHTML = `
      <strong>Edit mode</strong>
      <span class="gm-editbar-hint">${hint}</span>
      <code data-role="coords">x –, y –</code>
      ${downloads}
      <button type="button" data-action="toggle-edit">Done</button>`;
  }

  function stopPlacing() {
    placing = null;
    els.map.classList.remove('is-placing');
  }

  function markDirty(item) {
    dirty.add(item.ds);
    renderBar();
  }

  const api = {
    active: false,

    toggle() {
      api.active = !api.active;
      root.classList.toggle('is-editing', api.active);
      els.editbar.hidden = !api.active;
      for (const marker of markers.values()) setDraggable(marker, api.active);
      if (!api.active) stopPlacing();
      map.closePopup();
      renderBar();
      refresh();
    },

    moved(item, { x, y }) {
      item.raw.x = x;
      item.raw.y = y;
      markDirty(item);
    },

    startPlacing(item) {
      if (!api.active || !item) return;
      placing = item;
      els.map.classList.add('is-placing');
      map.closePopup();
      renderBar();
    },
  };

  map.on('mousemove', (event) => {
    if (!api.active) return;
    const { x, y } = fromLatLng(event.latlng);
    const out = els.editbar.querySelector('[data-role="coords"]');
    if (out) out.textContent = `x ${x}, y ${y}`;
  });

  map.on('click', (event) => {
    if (!api.active) return;
    const { x, y } = fromLatLng(event.latlng);
    if (placing) {
      const item = placing;
      const mapId = getMapId();
      item.raw.x = x;
      item.raw.y = y;
      if (item.mapId !== mapId) {
        item.mapId = mapId;
        item.raw.map = mapId;
      }
      const existing = markers.get(item.id);
      if (existing) existing.setLatLng(toLatLng(x, y, mapDefs.get(mapId)));
      else markerFor(item);
      stopPlacing();
      markDirty(item);
      refresh();
      return;
    }
    const snippet = `"x": ${x}, "y": ${y}`;
    L.popup({ className: 'gm-popup-wrap' })
      .setLatLng(event.latlng)
      .setContent(`
        <div class="gm-popup">
          <p class="gm-popup-cat">Coordinates</p>
          <code class="gm-code">${esc(snippet)}</code>
          <div class="gm-popup-actions"><button type="button" data-copy="${esc(snippet)}">Copy</button></div>
        </div>`)
      .openOn(map);
  });

  root.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      copyText(copyButton.dataset.copy).then(() => { copyButton.textContent = 'Copied'; }, () => {});
      return;
    }
    const downloadButton = event.target.closest('[data-download]');
    if (downloadButton) {
      const ds = [...dirty].find((d) => d.path === downloadButton.dataset.download);
      if (!ds) return;
      download(ds.path.split('/').pop(), formatDataset(ds.json));
      dirty.delete(ds);
      renderBar();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && placing) {
      stopPlacing();
      renderBar();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty.size) return;
    event.preventDefault();
    event.returnValue = '';
  });

  return api;
}
