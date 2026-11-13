import type { ReactNode } from 'react';

import type { IconName } from '../icons';
import { About } from './About';
import { AwayFromHome } from './AwayFromHome';
import { Bridge } from './Bridge';
import { HomeLocation } from './HomeLocation';
import { LightsAndRooms } from './LightsAndRooms';
import { MapSettings } from './MapSettings';
import { QuickTile } from './QuickTile';
import { Weather } from './Weather';
import { Widgets } from './Widgets';

export type GroupId = 'home' | 'widgets' | 'connection' | 'outside' | 'about';

/**
 * Settings groups: the Settings tab lists them, each opens its own screen
 * (`src/app/settings/[group].tsx`) with its sections stacked. Add a section to a group here.
 * `anchor` names a section a link can scroll to (glim://settings?section=tile).
 */
export const GROUPS: Record<GroupId, { title: string; icon: IconName; sections: { anchor?: string; node: ReactNode }[] }> = {
  home: {
    title: 'Your home',
    icon: 'map',
    sections: [{ node: <MapSettings /> }, { node: <LightsAndRooms /> }, { node: <HomeLocation /> }],
  },
  widgets: {
    title: 'Widgets and tile',
    icon: 'room',
    sections: [{ node: <Widgets /> }, { anchor: 'tile', node: <QuickTile /> }],
  },
  connection: {
    title: 'Bridge and connection',
    icon: 'bridge',
    sections: [{ node: <Bridge /> }, { node: <AwayFromHome /> }],
  },
  outside: {
    title: 'Weather on the map',
    icon: 'sun',
    sections: [{ node: <Weather /> }],
  },
  about: {
    title: 'About',
    icon: 'light',
    sections: [{ node: <About /> }],
  },
};

export const GROUP_ORDER: GroupId[] = ['home', 'widgets', 'connection', 'outside', 'about'];

/** The group holding a section anchor (`tile` → `widgets`). */
export const groupOfAnchor = (anchor: string) => GROUP_ORDER.find((g) => GROUPS[g].sections.some((s) => s.anchor === anchor)) ?? null;
