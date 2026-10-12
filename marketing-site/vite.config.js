import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Plain static build: the site deploys to Cloudflare Pages as a folder of
// assets (`wrangler pages deploy dist`), so it needs no Workers plugin.
export default defineConfig({
  plugins: [react()],
})
