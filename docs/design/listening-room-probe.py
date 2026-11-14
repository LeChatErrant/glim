#!/usr/bin/env python3
"""
Listening room feasibility probe (2026-11-14). Not app code: run from a Mac on the home Wi-Fi.

What it does, on the real bridge:
  1. records the color lights' state,
  2. creates a throwaway entertainment area ("Glim probe") from map-like positions,
  3. starts it, opens a DTLS 1.2 PSK session on UDP 2100 (openssl s_client), and streams
     HueStream v2 frames: a slow warm wave crossing the home from left to right,
  4. reads the lights while streaming, stops the stream, reads them again (are they put back?),
  5. optionally (--drop) starts again and kills the DTLS session without "stop", to see how
     the bridge reacts to a stream that just dies,
  6. deletes the area.

Needs HUE_BRIDGE_IP, HUE_APP_KEY and HUE_CLIENT_KEY (the pairing's clientkey) in the environment
or in ../../.env. Prints no key. Uses only the Python standard library and the openssl CLI (3.x).

  python3 -I docs/design/listening-room-probe.py [--seconds 8] [--hz 25] [--drop]
"""
import argparse
import json
import math
import os
import ssl
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    env = dict(os.environ)
    for cand in [os.path.join(HERE, '..', '..', '.env'), os.path.expanduser('~/Work/glim/.env')]:
        if os.path.exists(cand):
            for line in open(cand):
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1)
                    env.setdefault(k, v)
            break
    for k in ('HUE_BRIDGE_IP', 'HUE_APP_KEY', 'HUE_CLIENT_KEY'):
        if not env.get(k):
            sys.exit(f'missing {k}')
    return env


ENV = load_env()
IP, APP_KEY, CLIENT_KEY = ENV['HUE_BRIDGE_IP'], ENV['HUE_APP_KEY'], ENV['HUE_CLIENT_KEY']
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE  # probe only: the app pins the bridge's key instead


def api(method, path, body=None):
    req = urllib.request.Request(
        f'https://{IP}/clip/v2/resource/{path}',
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'hue-application-key': APP_KEY, 'content-type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=6) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'http_error': e.code, 'body': e.read().decode()}


def t():
    return time.monotonic()


# Positions in Hue's entertainment space (x -1 left .. 1 right, y -1 back .. 1 front, z -1 floor
# .. 1 ceiling), worked out from the real plan the way the app would: normalize the plan's bounds
# into [-1, 1] keeping its aspect, height from the light's type. Keys: device names on the bridge.
PLAN = {
    # name: (plan x px, plan y px, z by type)
    'Bureau': (440, 925, -0.2),               # Hue Go on a table
    'Lumière du salon': (582, 946, 0.8),      # pendant
    'Cuisine': (704, 972, 0.8),               # ceiling bulb
    'Lumière de la chambre': (308, 1054, 0.8),
    'Hue Play 2': (276, 1160, -0.6),          # light bar on the floor
    'Hue Play 1': (343, 1160, -0.6),
    'Salle de bain': (131, 1084, 0.8),
}
BOUNDS = (62, 740, 838, 1173)  # plan bounds (x0, y0, x1, y1), outdoor terrace included


def to_hue(px, py, z):
    x0, y0, x1, y1 = BOUNDS
    s = max(x1 - x0, y1 - y0) / 2
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # plan "up" (toward the terrace) = Hue front (+y)
    return round((px - cx) / s, 3), round(-(py - cy) / s, 3), z


def lights_state(ids):
    out = {}
    for l in api('GET', 'light')['data']:
        if l['id'] in ids:
            out[l['id']] = {
                'on': l['on']['on'],
                'bri': l.get('dimming', {}).get('brightness'),
                'xy': l.get('color', {}).get('xy'),
                'mode': l.get('mode'),
            }
    return out


def frame(seq, conf_id, channels, rgb_by_channel):
    head = b'HueStream' + bytes([2, 0, seq & 0xFF, 0, 0, 0, 0]) + conf_id.encode('ascii')
    body = b''
    for ch in channels:
        r, g, b = rgb_by_channel[ch]
        body += bytes([ch]) + b''.join(int(max(0, min(1, v)) * 0xFFFF).to_bytes(2, 'big') for v in (r, g, b))
    return head + body


def open_dtls():
    cmd = [
        'openssl', 's_client', '-dtls1_2', '-connect', f'{IP}:2100',
        '-psk_identity', APP_KEY, '-psk', CLIENT_KEY,
        '-cipher', 'PSK-AES128-GCM-SHA256:@SECLEVEL=0', '-quiet', '-nocommands',
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seconds', type=float, default=8)
    ap.add_argument('--hz', type=float, default=25)
    ap.add_argument('--drop', action='store_true')
    ap.add_argument('--black-tail', type=float, default=0, help='seconds of black frames before stop')
    ap.add_argument('--watch', type=int, default=0, help='seconds to watch the lights after stop')
    a = ap.parse_args()

    devices = {d['id']: d['metadata']['name'] for d in api('GET', 'device')['data']}
    ent = {e['id']: e for e in api('GET', 'entertainment')['data']}
    lights = {l['id']: l for l in api('GET', 'light')['data']}
    by_name = {}
    for e in ent.values():
        if not e.get('renderer'):
            continue
        name = devices.get(e['owner']['rid'])
        if name in PLAN:
            light = next(l for l in lights.values() if l['owner']['rid'] == e['owner']['rid'])
            by_name[name] = (e['id'], light['id'])
    print('renderers on the plan:', len(by_name), sorted(by_name))

    before = lights_state({lid for _, lid in by_name.values()})
    print('before:', json.dumps({devices[lights[k]['owner']['rid']]: v for k, v in before.items()}))

    locs = []
    pos = {}
    for name, (eid, _) in by_name.items():
        p = to_hue(*PLAN[name])
        pos[name] = p
        locs.append({'service': {'rtype': 'entertainment', 'rid': eid}, 'positions': [dict(zip('xyz', p))]})
    t0 = t()
    created = api('POST', 'entertainment_configuration', {
        'type': 'entertainment_configuration',
        'metadata': {'name': 'Glim probe'},
        'configuration_type': 'music',
        'locations': {'service_locations': locs},
    })
    print(f'create ({(t() - t0) * 1000:.0f} ms):', json.dumps(created)[:300])
    if 'data' not in created:
        return
    conf_id = created['data'][0]['rid']
    try:
        conf = api('GET', f'entertainment_configuration/{conf_id}')['data'][0]
        channel_of = {}
        for c in conf['channels']:
            rid = c['members'][0]['service']['rid']
            name = next(n for n, (eid, _) in by_name.items() if eid == rid)
            channel_of[c['channel_id']] = name
            print(f"  channel {c['channel_id']}: {name} at {c['position']}")
        channels = sorted(channel_of)

        def run(seconds, kill_without_stop=False):
            t0 = t()
            r = api('PUT', f'entertainment_configuration/{conf_id}', {'action': 'start'})
            print(f'start ({(t() - t0) * 1000:.0f} ms):', json.dumps(r)[:200])
            st = api('GET', f'entertainment_configuration/{conf_id}')['data'][0]
            print('  status', st['status'], 'active_streamer', st.get('active_streamer'))
            t1 = t()
            p = open_dtls()
            seq = 0
            # one empty write is not needed: s_client handshakes on connect. Give it time.
            time.sleep(0.6)
            if p.poll() is not None:
                print('DTLS failed:', p.stderr.read().decode()[:800])
                return
            print(f'  dtls up after <= {(t() - t1) * 1000:.0f} ms (process alive)')
            period = 1 / a.hz
            n = int(seconds * a.hz)
            mid_read = None
            start = t()
            for i in range(n):
                ph = (i / n) * 2.4 - 1.2  # wave front crosses x from -1.2 to 1.2
                rgb = {}
                for ch in channels:
                    x = pos[channel_of[ch]][0]
                    k = math.exp(-((x - ph) ** 2) / 0.06)
                    lvl = 0.06 + 0.94 * k
                    rgb[ch] = (1.0 * lvl, (0.45 + 0.2 * k) * lvl, (0.18 + 0.25 * k) * lvl)  # amber to rose
                p.stdin.write(frame(seq, conf_id, channels, rgb))
                p.stdin.flush()
                seq += 1
                if i == n // 2:
                    mid_read = lights_state({lid for _, lid in by_name.values()})
                time.sleep(max(0, start + (i + 1) * period - t()))
            if a.black_tail:
                for j in range(int(a.black_tail * a.hz)):
                    p.stdin.write(frame(seq, conf_id, channels, {ch: (0, 0, 0) for ch in channels}))
                    p.stdin.flush()
                    seq += 1
                    time.sleep(period)
            print(f'  sent {n} frames in {t() - start:.2f} s')
            if mid_read:
                print('  mid-stream REST read:', json.dumps({devices[lights[k]['owner']['rid']]: v for k, v in mid_read.items()}))
            if kill_without_stop:
                p.kill()
                print('  killed the DTLS session without stop; watching status')
                for s in range(14):
                    st = api('GET', f'entertainment_configuration/{conf_id}')['data'][0]
                    print(f'    +{s}s status {st["status"]}')
                    if st['status'] == 'inactive':
                        break
                    time.sleep(1)
            else:
                t2 = t()
                r = api('PUT', f'entertainment_configuration/{conf_id}', {'action': 'stop'})
                print(f'stop ({(t() - t2) * 1000:.0f} ms):', json.dumps(r)[:200])
                p.kill()
            for s in range(a.watch):
                time.sleep(1)
                w = lights_state({lid for _, lid in by_name.values()})
                print(f'    +{s + 1}s on:', sorted(devices[lights[k]['owner']['rid']] for k, v in w.items() if v['on']))
            time.sleep(1.5)
            after = lights_state({lid for _, lid in by_name.values()})
            print('after:', json.dumps({devices[lights[k]['owner']['rid']]: v for k, v in after.items()}))

        run(a.seconds)
        if a.drop:
            run(3, kill_without_stop=True)
    finally:
        r = api('DELETE', f'entertainment_configuration/{conf_id}')
        print('deleted probe area:', json.dumps(r)[:200])


if __name__ == '__main__':
    main()
