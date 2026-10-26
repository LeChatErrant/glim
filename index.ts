import 'expo-router/entry';
import { registerWidgetConfigurationScreen, registerWidgetTaskHandler } from 'react-native-android-widget';

import { MapWidgetConfig } from './src/widgets/MapWidgetConfig';
import { widgetTaskHandler } from './src/widgets/task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
registerWidgetConfigurationScreen(MapWidgetConfig);
