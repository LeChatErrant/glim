import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { getWidgetInfo, requestWidgetUpdateById, type WidgetInfo } from 'react-native-android-widget';

import { color } from '../../ui/theme';
import { WIDGET_NAMES } from '../../widgets/task-handler';
import { WidgetConfig } from '../../widgets/WidgetConfig';

/**
 * A placed widget's configuration, opened from Settings → Widgets: the same screen as long-pressing
 * the widget, inside the app. Saving redraws the widget; both Save and Cancel come back here.
 */
export default function WidgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<WidgetInfo | null>(null);

  useEffect(() => {
    (async () => {
      for (const name of WIDGET_NAMES) {
        const found = (await getWidgetInfo(name)).find((w) => String(w.widgetId) === id);
        if (found) return setInfo(found);
      }
      router.back();
    })();
  }, [id]);

  if (!info) return <View style={{ flex: 1, backgroundColor: color.ground }} />;
  return (
    <WidgetConfig
      widgetInfo={info}
      renderWidget={(widget) => {
        requestWidgetUpdateById({ widgetName: info.widgetName, widgetId: info.widgetId, renderWidget: () => widget }).catch(() => null);
      }}
      setResult={() => router.back()}
    />
  );
}
