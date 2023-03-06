import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import compressAudio from './compressAudioPlugin'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "^/Audios.*": {
        target: "http://localhost:5173",
        rewrite: (path) => path.replace("/Audios", "clips/compressed/Audios")
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {}
  },
  plugins: [
    vue(),
    compressAudio({ 
      rawAudioDir: "clips/raw", 
      compressedAudioDir: "clips/compressed", 
      rawAudioListDir:"audiolists", 
      generatedAudioListDir: "src/assets/AudioLists", 
      bitrate: 160000 
    })
  ],
})
