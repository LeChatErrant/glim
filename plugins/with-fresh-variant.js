// Glim Fresh: a "fresh" Android build type next to debug and release, for testing the first-time
// setup without touching the real app or the bridge's configuration.
//
//   (cd android && ./gradlew :app:assembleFresh -PreactNativeArchitectures=arm64-v8a)
//   adb install -r android/app/build/outputs/apk/fresh/app-fresh.apk
//
// Same code and JS as release, but its own package ID (io.lechaterrant.huelab.fresh: its own
// storage, installed beside Glim), its own name and its own link scheme (glimfresh://, so glim://
// links still open the real app). Being Fresh is read at run time from the package ID: native code
// then refuses every request that would change the bridge (Sandbox.kt), and JS keeps rooms,
// groups, scenes and behaviors on the phone (src/lib/hue/sandbox.ts).
const { withAppBuildGradle, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SCHEMES = { glim: 'glimScheme', huelab: 'huelabScheme' };

module.exports = function withFreshVariant(config) {
  config = withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (!g.includes('glimScheme')) {
      g = g.replace(
        /defaultConfig \{\n/,
        `defaultConfig {\n        manifestPlaceholders = [glimScheme: "glim", huelabScheme: "huelab"]\n`,
      );
      // A second buildTypes block after the template's: `initWith release` must see release
      // fully set up (signing, R8), or Fresh comes out unsigned and unshrunk.
      g = g.replace(
        /\n    packagingOptions \{/,
        `
    buildTypes {
        // Glim Fresh (plugins/with-fresh-variant.js): release, installed beside the real app.
        fresh {
            initWith release
            applicationIdSuffix ".fresh"
            matchingFallbacks = ['release']
            manifestPlaceholders = [glimScheme: "glimfresh", huelabScheme: "glimfresh"]
        }
    }
    packagingOptions {`,
      );
    }
    cfg.modResults.contents = g;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    for (const activity of cfg.modResults.manifest.application?.[0]?.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        for (const data of filter.data ?? []) {
          const placeholder = SCHEMES[data.$?.['android:scheme']];
          if (placeholder) data.$['android:scheme'] = `\${${placeholder}}`;
        }
      }
    }
    return cfg;
  });

  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const values = path.join(cfg.modRequest.platformProjectRoot, 'app/src/fresh/res/values');
      fs.mkdirSync(values, { recursive: true });
      fs.writeFileSync(
        path.join(values, 'strings.xml'),
        '<resources>\n  <string name="app_name">Glim Fresh</string>\n</resources>\n',
      );
      return cfg;
    },
  ]);
};
