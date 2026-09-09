import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({ output: 'static', site: process.env.PUBLIC_SITE_URL || undefined, integrations: [react()], server: { host: '127.0.0.1', port: 4321 }, devToolbar: { enabled: false } });
