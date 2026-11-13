import type { WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { MapWidgetConfig } from './MapWidgetConfig';
import { MoodsWidgetConfig } from './MoodsWidgetConfig';
import { TilesWidgetConfig } from './TilesWidgetConfig';

/** The library takes one configuration screen for every widget: each type gets its own. */
export function WidgetConfig(props: WidgetConfigurationScreenProps) {
  switch (props.widgetInfo.widgetName) {
    case 'Moods':
      return <MoodsWidgetConfig {...props} />;
    case 'Light':
    case 'Grid':
      return <TilesWidgetConfig {...props} />;
    default:
      return <MapWidgetConfig {...props} />;
  }
}
