import 'expo-router/entry';
import { registerWidgetConfigurationScreen, registerWidgetTaskHandler } from 'react-native-android-widget';

// Arriving home: the geofence task must be defined before Android wakes the app for it.
import './src/lib/rituals/arrive';
import { widgetTaskHandler } from './src/widgets/task-handler';
import { WidgetConfig } from './src/widgets/WidgetConfig';

registerWidgetTaskHandler(widgetTaskHandler);
registerWidgetConfigurationScreen(WidgetConfig);
