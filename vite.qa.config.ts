// QA server: identical to the normal config but without HMR/file watching, so pages under test
// are not reloaded while files change (parallel work, long software-rendered test runs).
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    server: { hmr: false, watch: { ignored: ['**/*'] } },
  }),
);
