import { mkdir, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve('src/preload/index.cjs')
const target = resolve('dist/preload/index.cjs')

await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
