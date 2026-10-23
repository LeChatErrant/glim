import Constants from 'expo-constants';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { requestPinWidget } from 'react-native-android-widget';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';

import { discoverBridges, pairOnce, probeBridge, saveBridge, type BridgeConfig, type DiscoveredBridge } from '../lib/hue/bridge';
import { cachedSnapshot, fetchSnapshot, type Light, type Snapshot } from '../lib/hue/client';
import { isLit, lightShape } from '../lib/lights';
import { loadMap, toPlan, type Plan } from '../lib/map/map';
import { Glow, PillButton, Rule } from '../ui/controls';
import { Jewel } from '../ui/FloorPlan';
import { Icon, type IconName } from '../ui/icons';
import { LinkDial, Radar, StatusLine, StepHeader, WidgetPreview } from '../ui/onboarding';
import { Display, Label, Txt } from '../ui/text';
import { color, font, hairline } from '../ui/theme';
import { refreshAllWidgets } from '../widgets/task-handler';

// First run: welcome, find the bridge, press its link button, see what was found, set up the map,
// add a widget. Works from a fresh bridge (no rooms, even no lights). "Control from anywhere" (the
// cloud step in the design) comes with cloud access, build step 4.

type Step = 'welcome' | 'bridge' | 'link' | 'found' | 'map' | 'widget';

const HAS_WIDGETS = Platform.OS === 'android';
const NUMBERED: Step[] = HAS_WIDGETS ? ['bridge', 'link', 'found', 'map', 'widget'] : ['bridge', 'link', 'found', 'map'];
/** Where Back goes. Not back to the link step once paired: that would pair again. */
const PREVIOUS: Partial<Record<Step, Step>> = { bridge: 'welcome', link: 'bridge', map: 'found', widget: 'map' };
const STEPS: Step[] = ['welcome', 'bridge', 'link', 'found', 'map', 'widget'];

const PAIR_WINDOW_S = 30;

export default function Onboarding() {
  // `?step=` opens a later step directly (handy to revisit them once paired).
  const params = useLocalSearchParams<{ step?: string }>();
  const [step, setStep] = useState<Step>(() => {
    const asked = params.step as Step;
    // The link step needs a bridge picked on the step before.
    return asked === 'link' ? 'bridge' : STEPS.includes(asked) ? asked : 'welcome';
  });
  const [bridge, setBridge] = useState<DiscoveredBridge | null>(null);

  const back = PREVIOUS[step];
  const goBack = back ? () => setStep(back) : undefined;
  const finish = useCallback(() => router.replace('/'), []);
  const afterMap = useCallback(() => (HAS_WIDGETS ? setStep('widget') : finish()), [finish]);

  useFocusEffect(
    useCallback(() => {
      if (!back) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setStep(back);
        return true;
      });
      return () => sub.remove();
    }, [back]),
  );

  const header = step === 'welcome' ? null : <StepHeader step={NUMBERED.indexOf(step) + 1} of={NUMBERED.length} onBack={goBack} />;

  switch (step) {
    case 'welcome':
      return <Welcome onStart={() => setStep('bridge')} />;
    case 'bridge':
      return (
        <BridgeStep
          header={header}
          onPick={(b) => {
            setBridge(b);
            setStep('link');
          }}
        />
      );
    case 'link':
      return bridge ? <LinkStep header={header} bridge={bridge} onPaired={() => setStep('found')} /> : null;
    case 'found':
      return <FoundStep header={header} onNext={() => setStep('map')} />;
    case 'map':
      return <MapStep header={header} onNext={afterMap} />;
    case 'widget':
      return <WidgetStep header={header} onDone={finish} />;
  }
}

/** Full-height step: header, scrollable content, actions pinned at the bottom. */
function StepScreen({ header, children, footer, glow }: { header: ReactNode; children: ReactNode; footer: ReactNode; glow?: boolean }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top + 22, paddingBottom: insets.bottom + 24 }}>
      {glow && <Glow tint="#FFB46B" cx={width / 2 - 20} cy={0} rx={350} ry={300} alpha={0.1} />}
      <View style={{ paddingHorizontal: 24 }}>{header}</View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 26, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, gap: 4 }}>{footer}</View>
    </View>
  );
}

/** Two-tone headline: the second part in champagne. */
function Title({ children, accent, size = 34 }: { children: string; accent: string; size?: number }) {
  return (
    <View accessibilityRole="header">
      <Display size={size}>
        {children}
        <Display size={size} style={{ color: color.champagne }}>
          {accent}
        </Display>
      </Display>
    </View>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <Txt tone="secondary" style={{ marginTop: 10 }}>
      {children}
    </Txt>
  );
}

// ——— Welcome ———

function Welcome({ onStart }: { onStart: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }}>
      <Glow tint="#FFB46B" cx={width / 2} cy={insets.top + 330} rx={360} ry={340} alpha={0.16} />
      <Display size={14} style={{ textAlign: 'center', letterSpacing: 14 * 0.32, paddingLeft: 14 * 0.32 }}>
        glim
      </Display>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <WelcomeLight />
      </View>
      <View style={{ paddingHorizontal: 24, alignItems: 'center' }}>
        <View accessibilityRole="header">
          <Display size={34} style={{ textAlign: 'center' }}>
            {'Your home,\n'}
            <Display size={34} style={{ color: color.champagne }}>
              in light
            </Display>
          </Display>
        </View>
        <Txt tone="secondary" style={{ textAlign: 'center', marginTop: 14, maxWidth: 290 }}>
          Every light in your home, on a map you can touch.
        </Txt>
        <PillButton title="Get started" kind="primary" onPress={onStart} style={{ alignSelf: 'stretch', marginTop: 40 }} />
        <Txt size={12} tone="muted" style={{ marginTop: 14 }}>
          Needs a Hue Bridge on your Wi-Fi
        </Txt>
      </View>
    </View>
  );
}

/** The glim mark, large: a warm light in its ivory ring, with halos and a pool on the floor. */
function WelcomeLight() {
  return (
    <Svg width={340} height={340}>
      <Defs>
        <RadialGradient id="wlGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFDEB0" stopOpacity={0.34} />
          <Stop offset="0.42" stopColor="#FFC27A" stopOpacity={0.12} />
          <Stop offset="1" stopColor="#FFC27A" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="wlPool" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFC27A" stopOpacity={0.2} />
          <Stop offset="0.55" stopColor="#FFC27A" stopOpacity={0.06} />
          <Stop offset="1" stopColor="#FFC27A" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="wlCore" cx="50%" cy="40%" r="60%">
          <Stop offset="0" stopColor="#FFFBF3" />
          <Stop offset="0.3" stopColor="#FFE9C8" />
          <Stop offset="0.72" stopColor="#FFC27A" />
          <Stop offset="1" stopColor="#F2A35E" />
        </RadialGradient>
        <RadialGradient id="wlHalo" cx="50%" cy="50%" r="50%">
          <Stop offset="0.3" stopColor="#FFC27A" stopOpacity={0.5} />
          <Stop offset="1" stopColor="#FFC27A" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={170} cy={170} r={169.5} fill="none" stroke={hairline(0.05)} />
      <Circle cx={170} cy={170} r={117.5} fill="none" stroke={hairline(0.08)} />
      <Ellipse cx={170} cy={310} rx={140} ry={24} fill="url(#wlPool)" />
      <Circle cx={170} cy={170} r={150} fill="url(#wlGlow)" />
      <Circle cx={170} cy={170} r={64} fill="url(#wlHalo)" />
      <Circle cx={170} cy={170} r={40.5} fill="none" stroke="rgba(255,246,230,0.6)" />
      <Circle cx={170} cy={170} r={32} fill="url(#wlCore)" />
    </Svg>
  );
}

// ——— Find the bridge ———

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function BridgeStep({ header, onPick }: { header: ReactNode; onPick: (b: DiscoveredBridge) => void }) {
  const [bridges, setBridges] = useState<DiscoveredBridge[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [search, setSearch] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [ip, setIp] = useState('');
  const [probing, setProbing] = useState(false);
  const [ipError, setIpError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    discoverBridges()
      .then((list) => {
        if (!alive) return;
        setSearchError(false);
        setBridges((prev) => merge(list, prev ?? []));
        setPicked((p) => p ?? list.find((b) => b.reachable)?.id ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setSearchError(true);
        setBridges((prev) => prev ?? []);
      });
    return () => {
      alive = false;
    };
  }, [search]);

  async function tryIp() {
    const address = ip.trim();
    if (!IPV4.test(address)) return setIpError('Enter an address like 192.168.1.20.');
    setProbing(true);
    setIpError(null);
    const found = await probeBridge(address);
    setProbing(false);
    if (!found) return setIpError(`No bridge answered at ${address}.`);
    setBridges((prev) => merge([found], prev ?? []));
    setPicked(found.id);
    setTyping(false);
  }

  const searching = bridges === null;
  const list = bridges ?? [];
  const chosen = list.find((b) => b.id === picked && b.reachable);
  const lead = searching
    ? 'Searching this Wi-Fi network.'
    : list.length
      ? 'Pick the bridge to use.'
      : searchError
        ? "Couldn't search for bridges. Check that you're online, or enter its address."
        : "No bridge found. Make sure your phone is on the same Wi-Fi as your bridge, and that it's plugged in.";

  return (
    <StepScreen
      header={header}
      footer={<PillButton title="Continue" kind="primary" disabled={!chosen} onPress={() => chosen && onPick(chosen)} />}
    >
      <Title accent="bridge">{'Find your '}</Title>
      <Lead>{lead}</Lead>

      <View style={{ marginTop: 16 }}>
        <Radar bridges={list} searching={searching} />
      </View>
      <View style={{ marginTop: 4 }}>
        {searching ? (
          <StatusLine glow>Searching</StatusLine>
        ) : (
          <StatusLine dot={list.length ? color.champagne : color.muted}>{list.length ? `${list.length} found` : 'None found'}</StatusLine>
        )}
      </View>

      {list.length > 0 && (
        <>
          <Label tone="label" style={{ marginTop: 28, marginBottom: 10 }}>
            On this network
          </Label>
          <View accessibilityRole="radiogroup" accessibilityLabel="Bridges" style={{ gap: 8 }}>
            {list.map((b) => (
              <BridgeRow key={b.id} bridge={b} selected={b.id === picked} onPress={() => setPicked(b.id)} />
            ))}
          </View>
        </>
      )}

      {typing ? (
        <View style={{ marginTop: 16, gap: 8 }}>
          <Label tone="label">Bridge address</Label>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={ip}
              onChangeText={(t) => {
                setIp(t);
                setIpError(null);
              }}
              onSubmitEditing={tryIp}
              placeholder="192.168.1.20"
              placeholderTextColor={color.muted}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              returnKeyType="go"
              accessibilityLabel="Bridge IP address"
              style={{
                flex: 1,
                height: 52,
                borderRadius: 26,
                borderWidth: 1,
                borderColor: hairline(0.16),
                paddingHorizontal: 20,
                color: color.ivory,
                fontFamily: font.ui,
                fontSize: 15,
              }}
            />
            {probing ? <ActivityIndicator color={color.champagne} style={{ width: 80 }} /> : <PillButton title="Check" onPress={tryIp} />}
          </View>
          {ipError && (
            <Txt size={13} style={{ color: color.error }}>
              {ipError}
            </Txt>
          )}
          <Txt size={12} tone="muted">
            {"Find it in your router's list of devices, or in the Hue app under Settings › Bridges."}
          </Txt>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', marginTop: 12, marginLeft: -12 }}>
          <PillButton title="Enter IP address" kind="text" icon="add" height={44} onPress={() => setTyping(true)} />
          {!searching && !list.some((b) => b.reachable) && (
            <PillButton
              title="Search again"
              kind="text"
              height={44}
              onPress={() => {
                setBridges(null);
                setSearch((n) => n + 1);
              }}
            />
          )}
        </View>
      )}
    </StepScreen>
  );
}

/** Keeps bridges added by hand when a search comes back, and lets a fresh result win. */
function merge(found: DiscoveredBridge[], prev: DiscoveredBridge[]) {
  const ids = new Set(found.map((b) => b.id));
  return [...found, ...prev.filter((b) => !ids.has(b.id))];
}

function BridgeRow({ bridge, selected, onPress }: { bridge: DiscoveredBridge; selected: boolean; onPress: () => void }) {
  const ok = bridge.reachable;
  return (
    <Pressable
      onPress={onPress}
      disabled={!ok}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !ok }}
      accessibilityLabel={`Hue Bridge, ${bridge.ip}, ${ok ? 'ready' : 'not responding'}`}
      style={({ pressed }) => ({
        height: 68,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingLeft: 14,
        paddingRight: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: selected && ok ? 'rgba(233,207,159,0.55)' : hairline(0.1),
        backgroundColor: selected && ok ? color.sheet : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderStyle: ok ? 'solid' : 'dashed',
          borderColor: ok ? 'rgba(233,207,159,0.4)' : hairline(0.2),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="bridge" size={18} tint={ok ? color.champagne : color.muted} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Display size={16} weight={400} style={{ color: ok ? color.ivory : color.muted }}>
          Hue Bridge
        </Display>
        <Txt size={12} tone={ok ? 'secondary' : 'muted'} style={{ fontVariant: ['tabular-nums'] }}>
          {bridge.ip}
        </Txt>
      </View>
      {ok ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color.connected }} />
          <Txt size={12} tone="secondary">
            Ready
          </Txt>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="warning" size={14} tint={color.warning} stroke={1.6} />
          <Txt size={12} style={{ color: color.warning }}>
            Not responding
          </Txt>
        </View>
      )}
      {ok && <Icon name="chevronRight" size={16} tint={selected ? color.champagne : color.muted} stroke={1.6} />}
    </Pressable>
  );
}

// ——— Press the link button ———

type LinkPhase = 'waiting' | 'success' | 'timeout' | 'error';

function LinkStep({ header, bridge, onPaired }: { header: ReactNode; bridge: DiscoveredBridge; onPaired: () => void }) {
  const [phase, setPhase] = useState<LinkPhase>('waiting');
  const [error, setError] = useState<string | null>(null);
  const [leftMs, setLeftMs] = useState(PAIR_WINDOW_S * 1000);
  const [run, setRun] = useState(0);
  const [notYet, setNotYet] = useState(false);
  /** Cuts the wait between attempts short ("Pressed it"). */
  const wake = useRef<() => void>(() => {});
  const paired = useRef(onPaired);
  useEffect(() => {
    paired.current = onPaired;
  });

  useEffect(() => {
    let alive = true;
    const end = Date.now() + PAIR_WINDOW_S * 1000;
    const tick = setInterval(() => setLeftMs(Math.max(0, end - Date.now())), 100);
    (async () => {
      while (alive && Date.now() < end) {
        const result = await pairOnce(bridge);
        if (!alive) return;
        if (result.ok) {
          clearInterval(tick);
          setPhase('success');
          await connect(result.config);
          if (alive) setTimeout(() => alive && paired.current(), 900);
          return;
        }
        if (result.reason === 'error') {
          clearInterval(tick);
          setError(result.message ?? 'Pairing failed.');
          setPhase('error');
          return;
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(t);
            wake.current = () => {};
            resolve();
          };
          const t = setTimeout(done, 1500);
          wake.current = () => {
            setNotYet(true);
            done();
          };
        });
      }
      clearInterval(tick);
      if (alive) setPhase('timeout');
    })();
    return () => {
      alive = false;
      clearInterval(tick);
      wake.current = () => {};
    };
  }, [bridge, run]);

  const retry = () => {
    setPhase('waiting');
    setError(null);
    setNotYet(false);
    setLeftMs(PAIR_WINDOW_S * 1000);
    setRun((n) => n + 1);
  };

  const seconds = Math.ceil(leftMs / 1000);
  const waiting = phase === 'waiting';
  return (
    <StepScreen
      header={header}
      footer={
        waiting ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -12 }}>
            <PillButton title="Start over" kind="text" icon="undo" height={44} onPress={retry} />
            <PillButton title="Pressed it" kind="text" height={44} onPress={() => wake.current()} />
          </View>
        ) : phase === 'success' ? (
          <View style={{ height: 52 }} />
        ) : (
          <PillButton title="Try again" kind="primary" onPress={retry} />
        )
      }
    >
      <Title size={32} accent="on your bridge">
        {'Press the round button\n'}
      </Title>
      <Lead>
        {phase === 'timeout'
          ? "The button wasn't pressed in time. Press it, then try again."
          : phase === 'error'
            ? "Couldn't reach the bridge."
            : "We'll connect as soon as you press it."}
      </Lead>

      <View style={{ marginTop: 28, width: 290, height: 290, alignSelf: 'center' }}>
        <Glow tint={color.champagne} cx={145} cy={145} rx={170} alpha={waiting || phase === 'success' ? 0.13 : 0.04} />
        <LinkDial left={leftMs / (PAIR_WINDOW_S * 1000)} seconds={seconds} phase={phase} />
        <View style={{ position: 'absolute', top: 236, left: 0, right: 0, height: 28, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          {waiting && (
            <Display size={22} style={{ fontVariant: ['tabular-nums'] }}>
              {seconds}
              <Txt size={14} tone="muted">
                {' s'}
              </Txt>
            </Display>
          )}
        </View>
      </View>

      <View style={{ marginTop: 16 }} accessibilityLiveRegion="polite">
        {phase === 'success' ? (
          <StatusLine dot={color.connected}>Connected</StatusLine>
        ) : phase === 'timeout' ? (
          <StatusLine dot={color.warning}>Timed out</StatusLine>
        ) : phase === 'error' ? (
          <StatusLine dot={color.error}>{"Couldn't connect"}</StatusLine>
        ) : (
          <StatusLine glow>{notYet ? 'Not pressed yet' : 'Waiting for the button'}</StatusLine>
        )}
      </View>
      {error && (
        <Txt size={13} tone="muted" style={{ textAlign: 'center', marginTop: 10 }}>
          {error}
        </Txt>
      )}
    </StepScreen>
  );
}

/** Saves the new pairing, then loads the home so the widgets stop asking to pair. */
async function connect(config: BridgeConfig) {
  await saveBridge(config);
  const snapshot = await fetchSnapshot().catch(() => null);
  refreshAllWidgets(snapshot).catch(() => null);
}

// ——— Lights found ———

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function FoundStep({ header, onNext }: { header: ReactNode; onNext: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [load, setLoad] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchSnapshot()
      .then((s) => alive && setSnapshot(s))
      .catch(async () => {
        const cached = await cachedSnapshot().catch(() => null);
        if (!alive) return;
        if (cached) setSnapshot(cached);
        else setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  const reload = () => {
    setFailed(false);
    setLoad((n) => n + 1);
  };

  if (!snapshot) {
    return (
      <StepScreen header={header} footer={failed ? <PillButton title="Try again" kind="primary" onPress={reload} /> : null}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color.connected }} />
          <Label tone="secondary">Connected · Hue Bridge</Label>
        </View>
        {failed ? (
          <>
            <Title accent="your lights">{"Couldn't read\n"}</Title>
            <Lead>{"The bridge didn't answer. Check that your phone is on the same Wi-Fi."}</Lead>
          </>
        ) : (
          <ActivityIndicator color={color.champagne} style={{ marginTop: 60 }} />
        )}
      </StepScreen>
    );
  }

  const { rooms, lights } = snapshot;
  const loose = lights.filter((l) => !l.roomId || !rooms.some((r) => r.id === l.roomId));
  const groups: { key: string; name: string; lights: Light[] }[] = [
    ...rooms.map((r) => ({ key: r.id, name: r.name, lights: lights.filter((l) => r.lightIds.includes(l.id)) })),
    ...(loose.length ? [{ key: 'loose', name: 'Not in a room', lights: loose }] : []),
  ];

  return (
    <StepScreen
      header={header}
      glow={lights.some(isLit)}
      footer={
        lights.length ? (
          <PillButton title="Continue" kind="primary" onPress={onNext} />
        ) : (
          <>
            <PillButton title="Check again" kind="primary" onPress={reload} />
            <PillButton title="Continue anyway" kind="text" onPress={onNext} />
          </>
        )
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color.connected }} />
        <Label tone="secondary">Connected · Hue Bridge</Label>
      </View>
      <View style={{ marginTop: 12 }}>
        {lights.length === 0 ? (
          <Title accent="yet">{'No lights '}</Title>
        ) : (
          <Title accent={rooms.length ? plural(rooms.length, 'room') : 'no rooms yet'}>{`${plural(lights.length, 'light')}, `}</Title>
        )}
      </View>
      <Lead>
        {lights.length === 0
          ? 'Add your lights to the bridge with the Hue app, then check again.'
          : rooms.length
            ? 'Names and rooms come from your bridge.'
            : "You'll create rooms while you set up your map."}
      </Lead>

      {groups.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 30, marginBottom: 6 }}>
            <Label tone="label">{rooms.length ? 'Rooms' : 'Lights'}</Label>
            <Label>Lights</Label>
          </View>
          <Rule />
          {groups.map((g) => (
            <View key={g.key}>
              <View style={{ minHeight: 66, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1, gap: 11 }}>
                  <Display size={17} weight={400} style={{ color: g.key === 'loose' ? color.secondary : color.ivory }} numberOfLines={1}>
                    {g.name}
                  </Display>
                  <JewelRow lights={g.lights} />
                </View>
                <Display size={22} style={{ fontVariant: ['tabular-nums'] }}>
                  {g.lights.length}
                </Display>
              </View>
              <Rule />
            </View>
          ))}
        </>
      )}
    </StepScreen>
  );
}

const JEWELS_SHOWN = 12;

function JewelRow({ lights }: { lights: Light[] }) {
  if (!lights.length) {
    return (
      <Txt size={12} tone="muted">
        No lights
      </Txt>
    );
  }
  const names = lights.map((l) => (l.kind === 'onoff' ? `${l.name} (smart plug)` : l.name)).join(', ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={names} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, height: 16, paddingLeft: 3 }}>
      {lights.slice(0, JEWELS_SHOWN).map((l) => (
        <Jewel key={l.id} light={l} shape={lightShape(l.archetype)} size={8} />
      ))}
      {lights.length > JEWELS_SHOWN && <Label size={9}>{`+${lights.length - JEWELS_SHOWN}`}</Label>}
    </View>
  );
}

// ——— Set up your map ———

function MapStep({ header, onNext }: { header: ReactNode; onNext: () => void }) {
  // Coming back from the scan or the editor with a map moves on; coming back empty-handed stays.
  const away = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!away.current) return;
      away.current = false;
      loadMap().then((m) => m?.rooms.length && onNext());
    }, [onNext]),
  );
  const open = (path: '/scan' | '/editor') => {
    away.current = true;
    router.push(path);
  };

  return (
    <StepScreen header={header} footer={<PillButton title="Skip for now" kind="text" onPress={onNext} />}>
      <Title accent="your map">{'Set up '}</Title>
      <Lead>Place each light where it really is, then tap it right on the map.</Lead>

      <Pressable
        onPress={() => open('/scan')}
        accessibilityRole="button"
        accessibilityLabel="Scan with camera. Recommended. About 3 minutes, walk room to room."
        style={({ pressed }) => ({
          height: 208,
          marginTop: 28,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: 'rgba(233,207,159,0.42)',
          backgroundColor: color.card,
          overflow: 'hidden',
          padding: 20,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Glow tint={color.champagne} cx={290} cy={60} rx={140} alpha={0.11} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <RoundIcon icon="scan" accent />
          <ScanSketch />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ alignSelf: 'flex-start', height: 22, paddingHorizontal: 9, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(233,207,159,0.5)', justifyContent: 'center' }}>
          <Label size={9} tone="champagne">
            Recommended
          </Label>
        </View>
        <Display size={20} weight={400} style={{ marginTop: 12 }}>
          Scan with camera
        </Display>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <Txt size={13} tone="secondary">
            About 3 minutes · walk room to room
          </Txt>
          <Icon name="chevronRight" size={16} tint={color.champagne} stroke={1.6} />
        </View>
      </Pressable>

      <Pressable
        onPress={() => open('/editor')}
        accessibilityRole="button"
        accessibilityLabel="Draw it myself. Trace rooms on a grid."
        style={({ pressed }) => ({
          height: 104,
          marginTop: 12,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: hairline(0.14),
          backgroundColor: color.card,
          paddingHorizontal: 20,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <RoundIcon icon="edit" />
        <View style={{ flex: 1, gap: 4 }}>
          <Display size={18} weight={400}>
            Draw it myself
          </Display>
          <Txt size={13} tone="secondary">
            Trace rooms on a grid
          </Txt>
        </View>
        <DrawSketch />
        <Icon name="chevronRight" size={16} tint={color.secondary} stroke={1.6} />
      </Pressable>

      <Txt size={13} tone="muted" style={{ marginTop: 18 }}>
        Either way, you can fine-tune the plan afterwards.
      </Txt>
    </StepScreen>
  );
}

function RoundIcon({ icon, accent }: { icon: IconName; accent?: boolean }) {
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: accent ? 'rgba(233,207,159,0.45)' : hairline(0.16),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={accent ? 20 : 18} tint={accent ? color.champagne : color.ivory} />
    </View>
  );
}

/** Corners traced on the floor, the reticle closing the last wall, lights glowing inside. */
function ScanSketch() {
  const corners = [
    [0, 0], [196, 0], [196, 120], [146, 120], [146, 214], [0, 214],
    [200, 0], [342, 0], [342, 116], [296, 138], [200, 138],
    [200, 214], [200, 142], [297, 142], [342, 121], [342, 214],
  ];
  const lights = [
    [84, 98, '#FFC27A'], [40, 44, '#FFD9A0'], [250, 66, '#FF9E6B'], [326, 32, '#8B7BFF'], [326, 76, '#FF6FB1'],
  ] as const;
  return (
    <Svg width={160} height={105} viewBox="-14 -14 370 242">
      <Path d="M0 0H196V120H146V214H0Z M200 0H342V116L296 138H200Z M200 214V142H297L342 121V214" fill="none" stroke={color.champagne} strokeOpacity={0.5} strokeWidth={2.3} />
      <Path d="M342 214H274" stroke={color.ivory} strokeOpacity={0.6} strokeWidth={2.3} strokeDasharray="7 9" />
      <Circle cx={262} cy={214} r={12} fill="none" stroke={color.ivory} strokeOpacity={0.8} strokeWidth={2.3} />
      <Circle cx={262} cy={214} r={3} fill={color.ivory} />
      {corners.map(([x, y]) => (
        <Circle key={`${x},${y}`} cx={x} cy={y} r={5} fill={color.champagne} />
      ))}
      {lights.map(([x, y, c]) => (
        <Circle key={`${x},${y}`} cx={x} cy={y} r={26} fill={c} opacity={0.22} />
      ))}
      {lights.map(([x, y, c]) => (
        <Circle key={`d${x},${y}`} cx={x} cy={y} r={7} fill={c} />
      ))}
    </Svg>
  );
}

function DrawSketch() {
  return (
    <Svg width={66} height={54}>
      <Path d="M4 4 H62 V30 H40 V50 H4 Z" fill="rgba(233,207,159,0.05)" stroke={color.champagne} strokeOpacity={0.55} strokeWidth={1} />
      {[[4, 4], [62, 4], [62, 30], [40, 30], [40, 50], [4, 50]].map(([x, y]) => (
        <Circle key={`${x},${y}`} cx={x} cy={y} r={2} fill={color.champagne} />
      ))}
    </Svg>
  );
}

// ——— Add a widget ———

function WidgetStep({ header, onDone }: { header: ReactNode; onDone: () => void }) {
  const [preview, setPreview] = useState<{ plan: Plan | null; snapshot: Snapshot | null }>({ plan: null, snapshot: null });
  const [asked, setAsked] = useState<'no' | 'yes' | 'unsupported'>('no');

  useEffect(() => {
    Promise.all([loadMap().catch(() => null), cachedSnapshot().catch(() => null)]).then(([map, snapshot]) =>
      setPreview({ plan: map && map.rooms.length ? toPlan(map) : null, snapshot }),
    );
  }, []);

  async function pin() {
    const ok = await requestPinWidget({ widgetName: 'Map' }).catch(() => false);
    setAsked(ok ? 'yes' : 'unsupported');
  }

  const lights = preview.snapshot?.lights ?? [];
  const appName = Constants.expoConfig?.name ?? 'the app';
  return (
    <StepScreen
      header={header}
      footer={
        asked === 'no' ? (
          <>
            <PillButton title="Add the map widget" kind="primary" icon="add" onPress={pin} />
            <PillButton title="Not now" kind="text" onPress={onDone} />
          </>
        ) : (
          <PillButton title="Done" kind="primary" onPress={onDone} />
        )
      }
    >
      <Title accent="your home screen">{'Add the map to\n'}</Title>
      <View style={{ marginTop: 28 }}>
        <WidgetPreview plan={preview.plan} lights={lights} rooms={preview.snapshot?.rooms ?? []} on={lights.filter(isLit).length} total={lights.length} />
      </View>

      {asked === 'yes' ? (
        <Txt tone="secondary" style={{ marginTop: 24 }}>
          Confirm on your home screen to place it. Long-press the widget later to resize it.
        </Txt>
      ) : (
        <>
          {asked === 'unsupported' && (
            <Txt tone="secondary" style={{ marginTop: 24 }}>
              {"Your launcher can't add it from here. Add it by hand:"}
            </Txt>
          )}
          <View style={{ marginTop: asked === 'unsupported' ? 8 : 30 }}>
            <View style={{ position: 'absolute', left: 15.5, top: 44, width: 1, height: 80, backgroundColor: 'rgba(233,207,159,0.25)' }} />
            <HowToRow n={1} text="Long-press an empty spot on your home screen" />
            <HowToRow n={2} text="Tap Widgets" />
            <HowToRow n={3} text={`Find ${appName} and drag the map widget into place`} />
          </View>
          <Txt size={12} tone="muted" style={{ marginTop: 14, marginLeft: 48 }}>
            Long-press the widget later to resize it.
          </Txt>
        </>
      )}
    </StepScreen>
  );
}

function HowToRow({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: 'rgba(233,207,159,0.5)',
          backgroundColor: color.ground,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Display size={14} style={{ color: color.champagne }}>
          {n}
        </Display>
      </View>
      <Txt size={14} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}
