# Game Maps

Interactive, data-driven maps for games. It's a static site with no build step: Leaflet draws the map, and everything you see comes from JSON files.

**Yakuza Kiwami** (`games/yakuza-kiwami/`): Kamurocho with all 50 locker keys, the coin lockers they open, and the landmarks the key descriptions refer to. A **Substories** layer is already wired up and is waiting for data.

## Features

- Pan and zoom a schematic Kamurocho map, with markers for every locker key (A1–J5) and its locker contents.
- Keys you get from substories (C1, I3, J5) are listed with their requirements and marked *not on map*.
- Tick **Found** to track progress. Progress is saved per browser, and you can hide found items.
- Search across names, descriptions and rewards (press `/`).
- Turn categories on and off: Collectibles, Side Quests, Places.
- Every marker has its own link (`…/yakuza-kiwami/#locker-b5`).
- **Edit mode** (`?edit` or the sidebar button) lets you drag markers, place items that have no position yet, click the map to read coordinates, and download the corrected data file.
- Works on phones: the sidebar becomes a drawer.

> **About accuracy:** I couldn't use the in-game map image, so `maps/kamurocho.svg` is a hand-drawn schematic built from written descriptions of the district. Markers are placed from guide descriptions ("in front of the Poppo on Tenkaichi St."), so they show the right block and street, not the exact pixel. Each popup includes the full written description. If a marker is off, fix it in Edit mode (see below).

## Running it

Browsers won't load JSON from `file://`, so serve the folder:

```sh
python3 -m http.server 8000     # or: npm run serve
# open http://localhost:8000
```

**GitHub Pages:** go to *Settings → Pages* and set the source to "Deploy from a branch", root folder. The `.nojekyll` file makes sure every file is served as-is.

## Layout

```
index.html                     landing page (reads games/index.json)
assets/
  css/map.css                  all styling
  js/game-map.js               map engine: loads game.json, renders layers, sidebar, popups
  js/edit-mode.js              drag/place/export tooling
  js/storage.js                found-progress + preferences in localStorage
  js/format.js                 canonical data-file layout (shared by editor + tools)
  vendor/leaflet/              Leaflet 1.9.4 (BSD-2-Clause)
games/
  index.json                   list of games on the landing page
  yakuza-kiwami/
    index.html                 mounts the engine with game.json
    game.json                  maps, groups, categories, data files
    maps/kamurocho.svg         base map (1200 x 1000 units)
    data/locker-keys.json
    data/substories.json       empty, ready for side quests
    data/places.json           coin lockers + landmarks
tools/
  validate.mjs                 checks configs and data (npm run validate)
  format-data.mjs              rewrites data files in canonical layout (npm run format)
```

## Data format

### `game.json`

| key | meaning |
| --- | --- |
| `maps[]` | `{ id, name, image, width, height }`. `image` can be SVG (inlined, so it stays crisp) or PNG/JPG. Marker coordinates use the same `width × height` space. With more than one map, the sidebar shows tabs (for example, an interior or Purgatory map later). |
| `groups[]` | Sidebar sections: `{ id, name }`. |
| `categories[]` | `{ id, group, name, color, icon, trackable?, showLabels?, hidden?, fields? }`. `icon` is one of `key`, `quest`, `locker`, `pin`, `star`. `trackable` adds the Found checkbox and a progress bar. `fields` lists extra item properties to show in the popup (`{ key, label }`). The first field with a value is also the subtitle in the list. |
| `data[]` | Data files, relative to the game folder. |
| `notes[]`, `credits` | Text for the About dialog. |

### Data files

```json
{
  "category": "locker-key",
  "map": "kamurocho",
  "items": [
    { "id": "locker-a1", "label": "A1", "name": "Locker Key A1", "x": 238, "y": 742,
      "description": "In front of the Poppo on Tenkaichi St.", "reward": "Medieval Silver Coin" }
  ]
}
```

`category` and `map` at the top are file defaults, and any item can override them. Item properties:

| property | |
| --- | --- |
| `id` | Required, unique across the whole game, lowercase with dashes. Used in URLs and saved progress, so don't rename it once published. |
| `name` | Required. |
| `x`, `y` | Map units, origin top-left, y grows downwards. Leave both out (or `null`) for things that aren't a place. |
| `label` | Short text drawn on the marker (`A1`, `42`). Without one, the category icon is shown. |
| `description` | How to find it. |
| `inside` | Building name, shown as "Indoors · …". |
| `notes` | Extra tips. |
| `requires` | `{ "substory": 42, "chapter": 5, "text": "…" }`. Shown in the popup. `substory` links to the substory entry with that `number` once it exists, and the substory's popup links back. |
| *(category fields)* | e.g. `reward`, `number`, `chapter`, as listed in that category's `fields`. |

## Adding side quests (substories)

The `substory` category, its sidebar entry (currently "coming soon") and `data/substories.json` already exist. To fill it in:

1. Open the map with `?edit`, click where the substory starts, and press **Copy** to get `"x": …, "y": …`.
2. Add an entry to `games/yakuza-kiwami/data/substories.json`:

   ```json
   { "id": "substory-42", "label": "42", "name": "Substory title", "number": 42,
     "chapter": "Chapter 5", "x": 612, "y": 679,
     "description": "Where to find the person who starts it.", "reward": "Locker key C1" }
   ```

3. Run `npm run format && npm run validate`.

Nothing else is needed. The category gets a progress bar, markers appear in pink, and locker keys C1, I3 and J5 (`requires.substory`) automatically link to their substory.

To add other kinds of things (Majima Everywhere encounters, minigames, restaurants…), add a category to `game.json`, add a data file, and list it in `data`.

## Fixing marker positions

1. Open `games/yakuza-kiwami/?edit`.
2. Drag markers to where they belong. Use **Place / Move** in the list for items with no position yet.
3. Click **Download locker-keys.json** in the edit bar and replace the file in `games/yakuza-kiwami/data/`.
4. Run `npm run validate` and commit.

## Using a real map image

To use a screenshot of the in-game map, put it in `maps/`, point the map's `image` at it, and set `width`/`height` to its pixel size. Positions are tied to the base image, so after the switch, re-place the markers in Edit mode.

## Adding another game

Copy `games/yakuza-kiwami/` to `games/<new-game>/`, edit `game.json` and the data, and add the game to `games/index.json`. The engine has no game-specific code.

## Checks

`npm run validate` (plain Node, no dependencies) checks for unknown categories or maps, duplicate ids, coordinates outside the map, x without y, substory references, and files not in canonical layout. CI runs it on every push and pull request.

## Credits

Locker key locations and contents were compiled from community guides (GameFAQs, TheGamer, RPG Site, Neoseeker, Sportskeeda). Yakuza Kiwami is a trademark of SEGA, and this is an unofficial fan project. Leaflet © Volodymyr Agafonkin, BSD-2-Clause (`assets/vendor/leaflet/LICENSE`).
