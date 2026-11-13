// app.json holds the config; this only adds the commit a build is made from, shown in
// Settings → About ("Glim 0.1.0 · a1b2c3d"). Evaluated when bundling, so a release build
// carries the commit it was built at.
const { execSync } = require('child_process');

module.exports = ({ config }) => {
  let commit = null;
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // Not a git checkout (an archive): no commit to show.
  }
  return { ...config, extra: { ...config.extra, commit } };
};
