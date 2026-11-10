// Downloads the Manhattan OpenStreetMap extract (© OpenStreetMap contributors, ODbL) from Overpass
// into a local cache that tools/build-nyc.mjs turns into assets/nyc/manhattan.bin.
// Small latitude bands hugging the island keep every request quick; build-nyc.mjs trims anything
// that is not on the islands using the coastline.
// Usage: node tools/fetch-osm.mjs [cacheDir]   (resumable: finished parts are skipped)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CACHE = process.argv[2] || path.join(os.tmpdir(), 'kts', 'osm');
const ENDPOINTS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const HEAD = '[out:json][timeout:240][maxsize:1000000000];';

// [south, north, west, east] — Manhattan, Roosevelt, Randall's, Governors and Liberty islands.
export const BANDS = [
  [40.680, 40.700, -74.050, -73.990],
  [40.700, 40.715, -74.025, -73.968],
  [40.715, 40.730, -74.020, -73.963],
  [40.730, 40.745, -74.016, -73.962],
  [40.745, 40.760, -74.013, -73.948],
  [40.760, 40.775, -74.006, -73.936],
  [40.775, 40.790, -73.996, -73.912],
  [40.790, 40.805, -73.986, -73.910],
  [40.805, 40.820, -73.970, -73.922],
  [40.820, 40.835, -73.962, -73.926],
  [40.835, 40.850, -73.953, -73.924],
  [40.850, 40.865, -73.946, -73.912],
  [40.865, 40.885, -73.936, -73.903],
];

const parts = [];
BANDS.forEach(([s, n, w, e], i) => {
  const bb = `(${s},${w},${n},${e})`;
  parts.push({ name: `buildings-${i}`, q: `${HEAD}(way["building"]${bb};way["building:part"]${bb};relation["building"]${bb};relation["building:part"]${bb};);out tags geom qt;` });
  parts.push({
    name: `misc-${i}`,
    q: `${HEAD}(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian)$"]${bb};`
      + `way["leisure"~"^(park|garden|playground|pitch|dog_park|recreation_ground|nature_reserve)$"]${bb};relation["leisure"~"^(park|garden|nature_reserve)$"]${bb};`
      + `way["landuse"~"^(grass|recreation_ground|cemetery|village_green|forest|meadow)$"]${bb};relation["landuse"~"^(grass|forest)$"]${bb};`
      + `way["natural"~"^(water|wood|scrub|grassland)$"]${bb};relation["natural"~"^(water|wood)$"]${bb};way["place"="square"]${bb};relation["highway"="pedestrian"]${bb};way["man_made"="pier"]${bb};`
      + `node["railway"="subway_entrance"]${bb};node["highway"="traffic_signals"]${bb};node["tourism"~"^(attraction|museum)$"]["name"]${bb};);out tags geom qt;`,
  });
});
parts.push({ name: 'coast', q: `${HEAD}(way["natural"="coastline"](40.66,-74.12,40.90,-73.86););out geom qt;` });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function run(p) {
  const file = path.join(CACHE, p.name + '.json');
  if (fs.existsSync(file) && fs.statSync(file).size > 64) { console.log('cached', p.name); return; }
  for (let attempt = 1; attempt <= 10; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(ENDPOINTS[(attempt - 1) % ENDPOINTS.length], {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'kts-game-builder/1.0 (offline map build)' },
        body: 'data=' + encodeURIComponent(p.q),
        signal: AbortSignal.timeout(300_000),
      });
      const text = await res.text();
      if (!res.ok || !text.startsWith('{') || text.includes('"remark": "runtime error')) throw new Error(`HTTP ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      fs.writeFileSync(file + '.part', text);
      fs.renameSync(file + '.part', file);
      console.log('ok', p.name, (text.length / 1e6).toFixed(1) + 'MB', ((Date.now() - t0) / 1000).toFixed(0) + 's');
      return;
    } catch (e) {
      const wait = Math.min(120, 15 * attempt);
      console.log('retry', p.name, attempt, e.message.slice(0, 140), `wait ${wait}s`);
      await sleep(wait * 1000);
    }
  }
  throw new Error('gave up on ' + p.name);
}

if (process.argv[1] && process.argv[1].endsWith('fetch-osm.mjs')) {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const p of parts) await run(p);
  console.log('done', CACHE);
}
