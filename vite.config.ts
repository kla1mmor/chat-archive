import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const build = Number(process.env.GITHUB_RUN_NUMBER || 0);

/** Writes dist/version.json, which the apps read to decide whether to update. */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    async generateBundle() {
      const { REQUIRED_PLUGINS } = await import('./src/version-plugins');
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build, plugins: REQUIRED_PLUGINS }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  test: { environment: 'node' },
});
