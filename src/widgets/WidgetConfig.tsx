import type { WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { MapWidgetConfig } from './MapWidgetConfig';
import { MoodsWidgetConfig } from './MoodsWidgetConfig';

/** The library takes one configuration screen for every widget: each type gets its own. */
export function WidgetConfig(props: WidgetConfigurationScreenProps) {
  return props.widgetInfo.widgetName === 'Moods' ? <MoodsWidgetConfig {...props} /> : <MapWidgetConfig {...props} />;
}
