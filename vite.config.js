import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import compressAudio from './compressAudioPlugin'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    compressAudio({ "input_audio_dir": "raw-audio", "output_folder": "Audios" })
  ],
})
