import { Alert } from 'react-native';

import { moveDeviceToRoom, type Snapshot } from '../lib/hue/client';

/**
 * When a light is placed in a map room linked to another Hue room (or to none), offer to
 * move it in Hue too. Needed to set up a new home from the app, where lights start in no room.
 */
export function offerMoveToRoom(
  snapshot: Snapshot | null,
  lightId: string,
  room: { name: string; hueRoomId: string | null },
  onMoved?: () => void,
) {
  const light = snapshot?.lights.find((l) => l.id === lightId);
  if (!light || !room.hueRoomId || light.roomId === room.hueRoomId) return;
  const from = snapshot?.rooms.find((r) => r.id === light.roomId)?.name;
  Alert.alert(
    `Move ${light.name} to ${room.name}?`,
    from
      ? `In Hue, it's in ${from}. Keep it there if it only sits here physically (like a bedside lamp with its own room).`
      : "In Hue, it isn't in any room yet.",
    [
      { text: 'Keep as is', style: 'cancel' },
      {
        text: `Move to ${room.name}`,
        onPress: () =>
          moveDeviceToRoom(light.deviceId, room.hueRoomId!)
            .then(() => onMoved?.())
            .catch((e) => Alert.alert("Couldn't move the light", String(e))),
      },
    ],
  );
}
