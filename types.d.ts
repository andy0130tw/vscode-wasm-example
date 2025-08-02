declare module '@agda-web/wasm-wasi-core' {
  import type { Uri } from 'vscode'
  import { Wasm } from '@vscode/wasm-wasi/v1'

  interface APILoader {
    load: () => Wasm
  }

  export const activate: (context: {
    extensionUri: Uri,
    extension: {
      packageJSON: {
        version: string
      }
    }
  }) => Promise<APILoader>
}
