// Records the bridge's configuration (rooms, groups, scenes, behaviors, smart scenes, device
// names and types) and compares it with an earlier record. Used to check that Glim Fresh, the
// sandbox build, left the real bridge as it was:
//
//   node scripts/bridge-config.mjs save before.json      # before a test session
//   node scripts/bridge-config.mjs diff before.json      # after: lists anything that changed
//
// Light state (on, color, brightness) isn't configuration and is left out. Reads HUE_BRIDGE_IP
// and HUE_APP_KEY from .env. Read-only: GET requests only. Local network only (the bridge's
// certificate is signed by Signify's private CA, so it isn't checked here).
import fs from 'node:fs';
import https from 'node:https';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
const { HUE_BRIDGE_IP: ip, HUE_APP_KEY: key } = env;
if (!ip || !key) throw new Error('HUE_BRIDGE_IP and HUE_APP_KEY must be set in .env');

const agent = new https.Agent({ rejectUnauthorized: false });
const get = (type) =>
  new Promise((resolve, reject) => {
    https
      .get({ host: ip, path: `/clip/v2/resource/${type}`, headers: { 'hue-application-key': key }, agent, timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(body).data) : reject(new Error(`${type}: HTTP ${res.statusCode}`))));
      })
      .on('error', reject);
  });

/** What counts as configuration, per resource type. Status fields that move on their own are dropped. */
const pick = {
  room: (r) => ({ metadata: r.metadata, children: r.children }),
  zone: (r) => ({ metadata: r.metadata, children: r.children }),
  scene: (r) => ({ metadata: r.metadata, group: r.group, actions: r.actions, palette: r.palette, speed: r.speed, auto_dynamic: r.auto_dynamic }),
  behavior_instance: (r) => ({ script_id: r.script_id, enabled: r.enabled, metadata: r.metadata, configuration: r.configuration }),
  smart_scene: (r) => ({ metadata: r.metadata, group: r.group, week_timeslots: r.week_timeslots, transition_duration: r.transition_duration }),
  device: (r) => ({ metadata: r.metadata }),
  light: (r) => ({ metadata: r.metadata, powerup: r.powerup }),
};

async function record() {
  const out = {};
  for (const [type, fn] of Object.entries(pick)) {
    out[type] = Object.fromEntries((await get(type)).map((r) => [r.id, fn(r)]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

const [cmd, file] = process.argv.slice(2);
if (cmd === 'save' && file) {
  const r = await record();
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
  console.log(`Saved ${Object.entries(r).map(([t, x]) => `${Object.keys(x).length} ${t}`).join(', ')} to ${file}`);
} else if (cmd === 'diff' && file) {
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = await record();
  const changes = [];
  for (const type of Object.keys(pick)) {
    const a = before[type] ?? {};
    const b = now[type] ?? {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const name = (b[id] ?? a[id])?.metadata?.name ?? '';
      if (!a[id]) changes.push(`+ ${type} ${id} ${name}`);
      else if (!b[id]) changes.push(`- ${type} ${id} ${name}`);
      else if (JSON.stringify(a[id]) !== JSON.stringify(b[id])) changes.push(`~ ${type} ${id} ${name}`);
    }
  }
  console.log(changes.length ? changes.join('\n') : 'No change: the bridge is configured exactly as before.');
  process.exitCode = changes.length ? 1 : 0;
} else {
  console.log('Usage: node scripts/bridge-config.mjs save <file> | diff <file>');
}
