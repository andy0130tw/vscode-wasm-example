import { Wasm } from '@vscode/wasm-wasi/v1'
import { Uri } from 'vscode'

export interface APILoader {
  load: () => Wasm
}

type URIConverters = {
  code2Protocol: (value: Uri) => string,
  protocol2Code: (value: string) => Uri,
}

declare class AgdaLanguageServerFactory {
  constructor (wasm: Wasm, module: WebAssembly.Module)
}

declare interface ALSWasmLoaderExports {
  AgdaLanguageServerFactory: AgdaLanguageServerFactory
  WasmAPILoader: APILoader
  // to be used in the `uriConverters` property of client options
  createUriConverters: () => URIConverters
}
