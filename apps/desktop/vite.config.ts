import { defineConfig } from 'vite'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

const projectRoot = resolve(__dirname, '../..')
const rendererLogoSource = resolve(projectRoot, 'assets/banner.png')

function copyRendererLogo(outDir: string) {
  if (!existsSync(rendererLogoSource)) {
    return
  }

  mkdirSync(outDir, { recursive: true })
  copyFileSync(rendererLogoSource, join(outDir, 'her-text-logo.png'))
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  envDir: __dirname,
  base: './',
  publicDir: resolve(__dirname, 'src/renderer/public'),
  plugins: [
    {
      name: 'her-text-renderer-logo',
      configureServer(server) {
        server.middlewares.use('/her-text-logo.png', (_request, response) => {
          if (!existsSync(rendererLogoSource)) {
            response.statusCode = 404
            response.end()
            return
          }

          response.setHeader('Content-Type', 'image/png')
          response.setHeader('Cache-Control', 'no-store')
          response.end(readFileSync(rendererLogoSource))
        })
      },
      writeBundle() {
        copyRendererLogo(resolve(__dirname, 'dist/renderer'))
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
