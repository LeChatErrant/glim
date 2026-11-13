import { call } from './client';

/**
 * Bridge-side automations (CLIP v2), used by rituals so they run with the phone off:
 * - `behavior_instance` runs one of Hue's built-in scripts (wake up, go to sleep) with our config.
 * - `smart_scene` switches between bridge scenes at set times of day (day rhythm).
 * - `scene` holds a look for some lights; created only when a ritual needs one.
 * Hue words stay in this file; the app calls these rituals.
 */

/** Built-in behavior scripts (same IDs on every bridge). */
export const SCRIPT = {
  /** Fades lights on, ending at the set time. Config: end_brightness, fade_in_duration, style 'sunrise' | 'basic'. */
  wakeUp: 'ff8957e3-2eb9-4699-a0c8-ad2cb3ede704',
  /** Fades lights out, starting at the set time. Config: end_state 'turn_off', fade_out_duration, style 'basic'. */
  goToSleep: '7e571ac6-f363-42e1-809a-4cbf6523ed72',
  /** Recalls scenes at a time. Config: when, what: [{ group, recall: scene }]. */
  schedule: '7238c707-8693-4f19-9095-ccdc1444d228',
} as const;

export type Ref = { rid: string; rtype: string };
export type TimePoint = { type: 'time'; time: { hour: number; minute: number } };
export type When = { recurrence_days?: string[]; time_point: TimePoint };

export type BehaviorInstance = {
  id: string;
  script_id: string;
  enabled: boolean;
  metadata: { name: string };
  configuration: Record<string, any> & { when?: When; where?: { group: Ref }[] };
  state?: Record<string, any>;
  status?: string;
};

const rid = (data: { rid?: string }[]) => {
  const id = data[0]?.rid;
  if (!id) throw new Error("The bridge didn't return the new item");
  return id;
};

export async function listBehaviors(): Promise<BehaviorInstance[]> {
  return (await call('behavior_instance')) as unknown as BehaviorInstance[];
}

export async function createBehavior(b: Omit<BehaviorInstance, 'id' | 'state' | 'status'>): Promise<string> {
  return rid((await call('behavior_instance', 'POST', { type: 'behavior_instance', ...b })) as { rid?: string }[]);
}

export function updateBehavior(id: string, change: Partial<Pick<BehaviorInstance, 'enabled' | 'metadata' | 'configuration'>>) {
  return call(`behavior_instance/${id}`, 'PUT', change);
}

export function deleteBehavior(id: string) {
  return call(`behavior_instance/${id}`, 'DELETE');
}

/** A scene's look for one light. */
export type SceneAction = { target: Ref; action: { on: { on: boolean }; dimming?: { brightness: number }; color_temperature?: { mirek: number } } };

export async function createScene(name: string, group: Ref, actions: SceneAction[]): Promise<string> {
  return rid((await call('scene', 'POST', { type: 'scene', metadata: { name }, group, actions })) as { rid?: string }[]);
}

export function updateScene(id: string, change: { name?: string; actions?: SceneAction[] }) {
  return call(`scene/${id}`, 'PUT', { ...(change.name ? { metadata: { name: change.name } } : {}), ...(change.actions ? { actions: change.actions } : {}) });
}

export function deleteScene(id: string) {
  return call(`scene/${id}`, 'DELETE');
}

export type SmartScene = {
  id: string;
  metadata: { name: string };
  group: Ref;
  week_timeslots: { recurrence: string[]; timeslots: { start_time: { kind: 'time'; time: { hour: number; minute: number; second: number } }; target: Ref }[] }[];
  transition_duration?: number;
  state: 'active' | 'inactive';
};

export async function listSmartScenes(): Promise<SmartScene[]> {
  return (await call('smart_scene')) as unknown as SmartScene[];
}

export async function createSmartScene(s: Omit<SmartScene, 'id' | 'state'>): Promise<string> {
  return rid((await call('smart_scene', 'POST', { type: 'smart_scene', ...s })) as { rid?: string }[]);
}

export function updateSmartScene(id: string, change: Partial<Pick<SmartScene, 'metadata' | 'week_timeslots' | 'transition_duration'>>) {
  return call(`smart_scene/${id}`, 'PUT', change);
}

/** Recalls the slot of the moment (turns the group on) and keeps following the slots until the lights are changed. */
export function activateSmartScene(id: string) {
  return call(`smart_scene/${id}`, 'PUT', { recall: { action: 'activate' } });
}

export function deactivateSmartScene(id: string) {
  return call(`smart_scene/${id}`, 'PUT', { recall: { action: 'deactivate' } });
}

export function deleteSmartScene(id: string) {
  return call(`smart_scene/${id}`, 'DELETE');
}
