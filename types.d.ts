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

declare interface WasiExample {
  AgdaLanguageServerFactory: AgdaLanguageServerFactory
  WasmAPILoader: APILoader
  loadBuiltInALSModule: () => Promise<WebAssembly.Module>
  createUriConverters: () => URIConverters
}
