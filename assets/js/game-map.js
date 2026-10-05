// Data-driven interactive game map.
//
// A game is described by a game.json (maps, category groups, categories, data files).
// Every data file is { category?, map?, items: [...] }; item-level `category`/`map`
// override the file defaults. Items with numeric x/y are drawn on the map, items
// without coordinates are still listed (e.g. rewards handed out by a substory).
//
// Nothing in here is game-specific: adding side quests, a new district or a whole
// new game is a matter of adding JSON (see README.md).

/* global L */
import { createPrefs, createProgress } from './storage.js';
import { createEditMode } from './edit-mode.js';
import { copyText, esc } from './util.js';

const ICONS = {
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 8a4 4 0 1 0 3.87 5H15v2h2v-2h1v2h2v-4h-8.13A4 4 0 0 0 8 8zm-1.5 4a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z"/></svg>',
  quest: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.6 3.5h2.8l-.45 11.5h-1.9zM12 17.2a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z"/></svg>',
  locker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M4 3h16v18H4zm2 2v6h5V5zm7 0v6h5V5zM6 13v6h5v-6zm7 0v6h5v-6z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
};
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

// Zoom tiers: far out, key pills shrink to dots; landmark names appear when zoomed in.
const DOT_ZOOM = -1;
const COMPACT_ZOOM = 0;
const LABEL_ZOOM = 0.5;

function safeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value ?? '') ? value : '#8b93a7';
}

function hasCoords(item) {
  return Number.isFinite(item.raw.x) && Number.isFinite(item.raw.y);
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url.pathname} returned HTTP ${res.status}`);
  return res.json();
}

async function loadBaseLayer(def, baseUrl, bounds) {
  const url = new URL(def.image, baseUrl);
  if (!url.pathname.endsWith('.svg')) return L.imageOverlay(url.href, bounds, { interactive: false });
  // Inline SVG (rather than <img>) keeps streets and labels crisp at every zoom level.
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url.pathname} returned HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  svg.setAttribute('preserveAspectRatio', 'none');
  return L.svgOverlay(svg, bounds, { interactive: false });
}

function buildModel(config, datasets) {
  const categories = new Map();
  for (const cat of config.categories) {
    categories.set(cat.id, { ...cat, color: safeColor(cat.color), items: [] });
  }
  const items = [];
  const byId = new Map();
  for (const ds of datasets) {
    for (const raw of ds.json.items ?? []) {
      const cat = categories.get(raw.category ?? ds.json.category);
      if (!cat) {
        console.warn(`[game-map] ${ds.path}: "${raw.id}" has unknown category, skipped`);
        continue;
      }
      if (byId.has(raw.id)) {
        console.warn(`[game-map] ${ds.path}: duplicate id "${raw.id}", skipped`);
        continue;
      }
      const item = { id: raw.id, raw, ds, cat, mapId: raw.map ?? ds.json.map ?? config.maps[0].id };
      item.search = [raw.label, raw.name, raw.description, raw.notes, raw.inside, ...(cat.fields ?? []).map((f) => raw[f.key])]
        .filter((v) => v != null)
        .join(' ')
        .toLowerCase();
      items.push(item);
      byId.set(item.id, item);
      cat.items.push(item);
    }
  }
  return { categories, items, byId };
}

function shell(config) {
  return `
    <aside class="gm-sidebar" aria-label="Map filters and list">
      <header class="gm-header">
        <a class="gm-back" href="../../">All maps</a>
        <h1>${esc(config.title)}</h1>
        ${config.subtitle ? `<p class="gm-subtitle">${esc(config.subtitle)}</p>` : ''}
      </header>
      <div class="gm-search">
        <input type="search" placeholder="Search keys, rewards, places…" aria-label="Search markers" data-role="search">
        <kbd aria-hidden="true">/</kbd>
      </div>
      <div class="gm-scroll">
        <div class="gm-maps" data-role="maps"></div>
        <div class="gm-filters" data-role="filters"></div>
        <label class="gm-switch"><input type="checkbox" data-role="hide-found"> Hide found</label>
        <ul class="gm-list" data-role="list"></ul>
      </div>
      <footer class="gm-footer">
        <button type="button" data-action="about">About &amp; tips</button>
        <button type="button" data-action="toggle-edit">Edit mode</button>
      </footer>
    </aside>
    <main class="gm-main">
      <div class="gm-map" data-role="map"></div>
      <button type="button" class="gm-drawer-toggle" data-action="drawer" aria-label="Show filters">☰ Filters</button>
      <div class="gm-editbar" data-role="editbar" hidden></div>
    </main>
    <dialog class="gm-dialog" data-role="about"></dialog>`;
}

export async function mountGameMap(root) {
  const configUrl = new URL(root.dataset.config || 'game.json', window.location.href);
  let config;
  let datasets;
  try {
    config = await fetchJSON(configUrl);
    datasets = await Promise.all(
      config.data.map(async (path) => ({ path, json: await fetchJSON(new URL(path, configUrl)) })),
    );
  } catch (err) {
    const fileHint = window.location.protocol === 'file:'
      ? '<p>Browsers block data loading from <code>file://</code> pages. Serve the folder instead, e.g. <code>python3 -m http.server</code> in the repository root, then open <code>http://localhost:8000</code>.</p>'
      : '';
    root.innerHTML = `<div class="gm-error"><h1>Map failed to load</h1><p>${esc(err.message)}</p>${fileHint}</div>`;
    return;
  }

  const { categories, items, byId } = buildModel(config, datasets);
  const mapDefs = new Map(config.maps.map((m) => [m.id, m]));
  const progress = createProgress(config.id);
  const prefs = createPrefs(config.id, {
    hidden: config.categories.filter((c) => c.hidden).map((c) => c.id),
    hideFound: false,
  });
  const state = {
    mapId: mapDefs.has(prefs.get('map')) ? prefs.get('map') : config.maps[0].id,
    hidden: new Set(prefs.get('hidden')),
    hideFound: Boolean(prefs.get('hideFound')),
    query: '',
    activeId: null,
  };

  document.title = `${config.title} Interactive Map`;
  root.innerHTML = shell(config);
  const $ = (role) => root.querySelector(`[data-role="${role}"]`);
  const els = {
    search: $('search'), maps: $('maps'), filters: $('filters'), hideFound: $('hide-found'),
    list: $('list'), map: $('map'), editbar: $('editbar'), about: $('about'),
  };
  els.hideFound.checked = state.hideFound;

  // ---- Leaflet setup -------------------------------------------------------
  const map = L.map(els.map, {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 2,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 110,
    attributionControl: false,
    zoomControl: false,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);

  const currentDef = () => mapDefs.get(state.mapId);
  // Data uses image-style coordinates (origin top-left, y down); Leaflet's CRS.Simple has y up.
  const toLatLng = (x, y, def = currentDef()) => L.latLng(def.height - y, x);
  const fromLatLng = (latlng, def = currentDef()) => ({ x: Math.round(latlng.lng), y: Math.round(def.height - latlng.lat) });

  const layers = new Map([...categories.keys()].map((id) => [id, L.layerGroup().addTo(map)]));
  const markers = new Map();
  let baseLayer = null;

  // Landmark names live in their own pane under the marker pane so they never cover a key.
  map.createPane('gm-labels').style.zIndex = 590;

  const syncZoomTier = () => {
    const zoom = map.getZoom();
    els.map.classList.toggle('gm-zoom-dots', zoom < DOT_ZOOM);
    els.map.classList.toggle('gm-zoom-compact', zoom < COMPACT_ZOOM);
    els.map.classList.toggle('gm-zoom-far', zoom < LABEL_ZOOM);
  };
  map.on('zoomend', syncZoomTier);

  // ---- markers -------------------------------------------------------------
  function isFound(item) {
    return Boolean(item.cat.trackable) && progress.has(item.id);
  }

  function badgeHtml(item) {
    return item.raw.label ? esc(item.raw.label) : ICONS[item.cat.icon] ?? ICONS.pin;
  }

  function iconFor(item) {
    const kind = item.raw.label ? 'label' : item.cat.showLabels ? 'dot' : 'icon';
    const classes = ['gm-pin', `gm-pin--${kind}`];
    if (isFound(item)) classes.push('is-found');
    if (state.activeId === item.id) classes.push('is-active');
    return L.divIcon({
      className: 'gm-marker',
      html: `<span class="${classes.join(' ')}" style="--c:${item.cat.color}">${kind === 'dot' ? '' : badgeHtml(item)}</span>`,
      iconSize: null,
      popupAnchor: [0, kind === 'dot' ? -6 : -12],
    });
  }

  function markerFor(item) {
    let marker = markers.get(item.id);
    if (marker) return marker;
    marker = L.marker(toLatLng(item.raw.x, item.raw.y, mapDefs.get(item.mapId)), {
      icon: iconFor(item),
      title: item.raw.name,
      alt: item.raw.name,
      riseOnHover: true,
      draggable: edit.active,
      zIndexOffset: item.cat.trackable ? 1000 : 0,
    });
    marker.bindPopup(() => popupHtml(item), { className: 'gm-popup-wrap', maxWidth: 320, minWidth: 220 });
    if (item.cat.showLabels) {
      marker.bindTooltip(esc(item.raw.name), { permanent: true, direction: 'right', offset: [7, 0], className: 'gm-label', pane: 'gm-labels' });
    }
    marker.on('popupopen', () => setActive(item.id));
    marker.on('popupclose', () => state.activeId === item.id && setActive(null));
    marker.on('dragend', () => edit.moved(item, fromLatLng(marker.getLatLng(), mapDefs.get(item.mapId))));
    markers.set(item.id, marker);
    return marker;
  }

  function refreshIcon(item) {
    markers.get(item.id)?.setIcon(iconFor(item));
  }

  function matchesQuery(item) {
    const q = state.query.trim().toLowerCase();
    return !q || q.split(/\s+/).every((word) => item.search.includes(word));
  }

  function isListed(item) {
    return !state.hidden.has(item.cat.id) && !(state.hideFound && isFound(item)) && matchesQuery(item);
  }

  function syncMarkers() {
    for (const item of items) {
      const show = item.mapId === state.mapId && hasCoords(item) && (isListed(item) || item.id === state.activeId);
      const layer = layers.get(item.cat.id);
      const marker = show ? markerFor(item) : markers.get(item.id);
      if (!marker) continue;
      if (show && !layer.hasLayer(marker)) layer.addLayer(marker);
      if (!show && layer.hasLayer(marker)) layer.removeLayer(marker);
    }
  }

  // ---- popup ---------------------------------------------------------------
  function requirementHtml(req) {
    if (!req) return '';
    const parts = [];
    if (req.substory != null) {
      const sub = items.find((i) => i.cat.id === 'substory' && i.raw.number === req.substory);
      const label = `Substory #${esc(req.substory)}${sub ? `: ${esc(sub.raw.name)}` : ''}`;
      parts.push(`Reward for completing ${sub ? `<a href="#${encodeURIComponent(sub.id)}">${label}</a>` : label}`);
    }
    if (req.chapter != null) parts.push(`Available from Chapter ${esc(req.chapter)}`);
    if (req.text) parts.push(esc(req.text));
    return parts.map((p) => `<p class="gm-popup-req">${p}</p>`).join('');
  }

  function popupHtml(item) {
    const { raw, cat } = item;
    const fields = (cat.fields ?? [])
      .filter((f) => raw[f.key] != null && raw[f.key] !== '')
      .map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(raw[f.key])}</dd>`)
      .join('');
    const rewardsHere = items.filter((i) => i.raw.requires?.substory != null && cat.id === 'substory' && i.raw.requires.substory === raw.number);
    return `
      <article class="gm-popup" data-id="${esc(item.id)}">
        <p class="gm-popup-cat" style="--c:${cat.color}">${esc(cat.name)}</p>
        <h3>${esc(raw.name)}</h3>
        ${raw.inside ? `<p class="gm-popup-inside">Indoors · ${esc(raw.inside)}</p>` : ''}
        ${raw.description ? `<p>${esc(raw.description)}</p>` : ''}
        ${fields ? `<dl>${fields}</dl>` : ''}
        ${requirementHtml(raw.requires)}
        ${rewardsHere.map((r) => `<p class="gm-popup-req">Also rewards <a href="#${encodeURIComponent(r.id)}">${esc(r.raw.name)}</a></p>`).join('')}
        ${raw.notes ? `<p class="gm-popup-notes">${esc(raw.notes)}</p>` : ''}
        ${hasCoords(item) ? '' : '<p class="gm-popup-notes">Not a map location, so there is no marker for it.</p>'}
        ${edit.active && hasCoords(item) ? `<code class="gm-code">"x": ${raw.x}, "y": ${raw.y}</code>` : ''}
        <div class="gm-popup-actions">
          ${cat.trackable ? `<label class="gm-found"><input type="checkbox" data-found="${esc(item.id)}" ${isFound(item) ? 'checked' : ''}> Found</label>` : ''}
          <a class="gm-permalink" href="#${encodeURIComponent(item.id)}" data-action="copy-link" title="Copy a link to this marker">Copy link</a>
        </div>
      </article>`;
  }

  // ---- sidebar -------------------------------------------------------------
  function renderMapTabs() {
    if (config.maps.length < 2) {
      els.maps.hidden = true;
      return;
    }
    els.maps.innerHTML = config.maps
      .map((m) => `<button type="button" data-map="${esc(m.id)}" aria-pressed="${m.id === state.mapId}">${esc(m.name)}</button>`)
      .join('');
  }

  function renderFilters() {
    els.filters.innerHTML = config.groups
      .map((group) => {
        const cats = [...categories.values()].filter((c) => c.group === group.id);
        if (!cats.length) return '';
        return `<section class="gm-group"><h2>${esc(group.name)}</h2>${cats.map(categoryRow).join('')}</section>`;
      })
      .join('');
  }

  function categoryRow(cat) {
    const empty = cat.items.length === 0;
    return `
      <div class="gm-cat${empty ? ' is-empty' : ''}" data-cat-row="${esc(cat.id)}">
        <label>
          <input type="checkbox" data-cat="${esc(cat.id)}" ${empty ? 'disabled' : state.hidden.has(cat.id) ? '' : 'checked'}>
          <span class="gm-cat-icon" style="--c:${cat.color}">${ICONS[cat.icon] ?? ICONS.pin}</span>
          <span class="gm-cat-name">${esc(cat.name)}</span>
          <span class="gm-cat-count" data-count></span>
        </label>
        ${cat.trackable && !empty ? '<div class="gm-bar"><span data-bar></span></div>' : ''}
      </div>`;
  }

  function updateCounts() {
    for (const cat of categories.values()) {
      const row = els.filters.querySelector(`[data-cat-row="${CSS.escape(cat.id)}"]`);
      if (!row) continue;
      const total = cat.items.length;
      const found = cat.trackable ? cat.items.filter(isFound).length : 0;
      row.querySelector('[data-count]').textContent = total === 0 ? 'coming soon' : cat.trackable ? `${found} / ${total}` : String(total);
      const bar = row.querySelector('[data-bar]');
      if (bar) bar.style.width = `${(found / total) * 100}%`;
    }
  }

  function subtitleFor(item) {
    const firstField = (item.cat.fields ?? []).find((f) => item.raw[f.key] != null && item.raw[f.key] !== '');
    return firstField ? item.raw[firstField.key] : item.raw.description ?? '';
  }

  function renderList() {
    const groups = [...categories.values()]
      .map((cat) => ({ cat, items: cat.items.filter((i) => i.mapId === state.mapId || !hasCoords(i)).filter(isListed) }))
      .filter((g) => g.items.length);
    if (!groups.length) {
      els.list.innerHTML = `<li class="gm-empty">${state.query ? 'Nothing matches that search.' : 'No categories selected.'}</li>`;
      return;
    }
    els.list.innerHTML = groups
      .map(({ cat, items: catItems }) => `
        <li class="gm-list-head">${esc(cat.name)} <span>${catItems.length}</span></li>
        ${catItems.map((item) => listItem(item)).join('')}`)
      .join('');
  }

  function listItem(item) {
    const found = isFound(item);
    const placed = hasCoords(item);
    return `
      <li class="gm-item${found ? ' is-found' : ''}${state.activeId === item.id ? ' is-active' : ''}" data-id="${esc(item.id)}">
        ${item.cat.trackable ? `<button type="button" class="gm-check" data-action="found" aria-pressed="${found}" aria-label="Mark ${esc(item.raw.name)} as found">${CHECK}</button>` : ''}
        <button type="button" class="gm-item-main" data-action="focus">
          <span class="gm-badge${item.raw.label ? '' : ' gm-badge--icon'}" style="--c:${item.cat.color}">${badgeHtml(item)}</span>
          <span class="gm-item-text">
            <span class="gm-item-name">${esc(item.raw.name)}${placed ? '' : ' <em class="gm-tag">not on map</em>'}</span>
            <span class="gm-item-sub">${esc(subtitleFor(item))}</span>
          </span>
        </button>
        ${edit.active ? `<button type="button" class="gm-place" data-action="place" title="Click the map to set this position">${placed ? 'Move' : 'Place'}</button>` : ''}
      </li>`;
  }

  function refresh() {
    syncMarkers();
    updateCounts();
    renderList();
  }

  // ---- interactions --------------------------------------------------------
  function setActive(id) {
    const previous = state.activeId;
    state.activeId = id;
    for (const prevOrNext of [previous, id]) {
      const item = prevOrNext && byId.get(prevOrNext);
      if (item) refreshIcon(item);
    }
    for (const li of els.list.querySelectorAll('.gm-item.is-active')) li.classList.remove('is-active');
    if (id) {
      const li = els.list.querySelector(`.gm-item[data-id="${CSS.escape(id)}"]`);
      li?.classList.add('is-active');
      li?.scrollIntoView({ block: 'nearest' });
      history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    } else if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (!id) syncMarkers();
  }

  function setFound(id, value) {
    const item = byId.get(id);
    if (!item?.cat.trackable) return;
    progress.set(id, value);
    refreshIcon(item);
    for (const box of root.querySelectorAll(`[data-found="${CSS.escape(id)}"]`)) box.checked = value;
    updateCounts();
    renderList();
  }

  async function switchMap(mapId, { fit = true } = {}) {
    const def = mapDefs.get(mapId);
    if (!def) return;
    state.mapId = mapId;
    prefs.set('map', mapId);
    map.closePopup();
    const bounds = L.latLngBounds([0, 0], [def.height, def.width]);
    const next = await loadBaseLayer(def, configUrl, bounds);
    baseLayer?.remove();
    baseLayer = next.addTo(map);
    baseLayer.bringToBack();
    map.setMaxBounds(bounds.pad(0.35));
    if (fit) {
      map.fitBounds(bounds, { padding: [12, 12] });
      // Phones: "contain" leaves the map tiny, so fill the screen instead and let people pan.
      if (els.map.clientWidth < 600) {
        const cover = Math.log2(Math.max(els.map.clientWidth / def.width, els.map.clientHeight / def.height));
        map.setView(bounds.getCenter(), Math.max(map.getZoom(), cover), { animate: false });
      }
    }
    syncZoomTier();
    renderMapTabs();
    refresh();
  }

  async function focusItem(id) {
    const item = byId.get(id);
    if (!item) return;
    if (state.hidden.has(item.cat.id)) toggleCategory(item.cat.id, true);
    if (hasCoords(item) && item.mapId !== state.mapId) await switchMap(item.mapId, { fit: false });
    closeDrawer();
    if (!hasCoords(item)) {
      L.popup({ className: 'gm-popup-wrap', maxWidth: 320, minWidth: 220 })
        .setLatLng(map.getCenter())
        .setContent(popupHtml(item))
        .on('remove', () => state.activeId === id && setActive(null))
        .openOn(map);
      setActive(id);
      return;
    }
    state.activeId = id;
    syncMarkers();
    const marker = markerFor(item);
    const zoom = Math.max(map.getZoom(), 1);
    const target = marker.getLatLng();
    if (map.distance(map.getCenter(), target) < 2 && map.getZoom() === zoom) {
      marker.openPopup();
    } else {
      map.once('moveend', () => marker.openPopup());
      map.flyTo(target, zoom, { duration: 0.6 });
    }
  }

  function toggleCategory(catId, visible) {
    if (visible) state.hidden.delete(catId);
    else state.hidden.add(catId);
    prefs.set('hidden', [...state.hidden]);
    const box = els.filters.querySelector(`[data-cat="${CSS.escape(catId)}"]`);
    if (box) box.checked = visible;
    refresh();
  }

  function openDrawer() {
    root.classList.add('is-drawer-open');
  }

  function closeDrawer() {
    root.classList.remove('is-drawer-open');
  }

  function renderAbout() {
    const notes = (config.notes ?? []).map((n) => `<p>${esc(n)}</p>`).join('');
    const credits = config.credits ? `<p class="gm-muted">${esc(config.credits)}</p>` : '';
    els.about.innerHTML = `
      <form method="dialog">
        <h2>${esc(config.title)} map</h2>
        ${notes}
        <h3>Tips</h3>
        <ul>
          <li>Click a marker or a list entry for details; tick <strong>Found</strong> to track progress. Progress is saved in this browser.</li>
          <li>Press <kbd>/</kbd> to search. <em>Copy link</em> in a popup gives you a link straight to that marker.</li>
          <li><strong>Edit mode</strong> lets you drag markers, read coordinates and download corrected data files.</li>
        </ul>
        ${credits}
        <div class="gm-dialog-actions">
          <button type="button" data-action="reset-progress" class="gm-danger">Reset progress</button>
          <button value="close">Close</button>
        </div>
      </form>`;
  }

  const edit = createEditMode({
    root, map, els, markers, toLatLng, fromLatLng, mapDefs, markerFor, refresh,
    getMapId: () => state.mapId,
  });

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action], [data-map]');
    if (!target) return;
    const li = target.closest('.gm-item');
    switch (target.dataset.action) {
      case 'focus': focusItem(li.dataset.id); break;
      case 'found': setFound(li.dataset.id, !progress.has(li.dataset.id)); break;
      case 'place': edit.startPlacing(byId.get(li.dataset.id)); closeDrawer(); break;
      case 'about': renderAbout(); els.about.showModal(); break;
      case 'toggle-edit': edit.toggle(); closeDrawer(); break;
      case 'drawer': root.classList.contains('is-drawer-open') ? closeDrawer() : openDrawer(); break;
      case 'copy-link': {
        event.preventDefault();
        const url = new URL(target.getAttribute('href'), window.location.href).href;
        copyText(url).then(
          () => { target.textContent = 'Link copied'; },
          () => window.prompt('Copy this link:', url),
        );
        break;
      }
      case 'reset-progress': {
        const tracked = items.filter((i) => i.cat.trackable).map((i) => i.id);
        if (window.confirm('Clear every "found" checkmark for this game?')) {
          progress.clear(tracked);
          for (const id of tracked) refreshIcon(byId.get(id));
          refresh();
          els.about.close();
        }
        break;
      }
      default:
        if (target.dataset.map) switchMap(target.dataset.map);
    }
  });

  root.addEventListener('change', (event) => {
    const { target } = event;
    if (target.dataset.cat) toggleCategory(target.dataset.cat, target.checked);
    else if (target.dataset.found) setFound(target.dataset.found, target.checked);
    else if (target === els.hideFound) {
      state.hideFound = target.checked;
      prefs.set('hideFound', state.hideFound);
      refresh();
    }
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    refresh();
  });
  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.search.value = '';
      state.query = '';
      refresh();
    }
  });
  document.addEventListener('keydown', (event) => {
    const typing = /^(input|textarea|select)$/i.test(event.target.tagName);
    if (event.key === '/' && !typing) {
      event.preventDefault();
      openDrawer();
      els.search.focus();
    }
  });
  window.addEventListener('hashchange', () => focusItem(decodeURIComponent(window.location.hash.slice(1))));

  renderFilters();
  await switchMap(state.mapId);
  if (new URLSearchParams(window.location.search).has('edit')) edit.toggle();
  if (window.location.hash) focusItem(decodeURIComponent(window.location.hash.slice(1)));
}
