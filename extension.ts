/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MountPointDescriptor, ProcessOptions, Wasm } from '@vscode/wasm-wasi/v1';

import * as WasmWasiCore from '@agda-web/wasm-wasi-core';

import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@vscode/wasm-wasi-lsp';
import { commands, ExtensionContext, LogOutputChannel, OutputChannel, Uri, window, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions } from 'vscode-languageclient';
import { populateAgdaDataDir } from './data';

let logger: OutputChannel
let traceLogger: LogOutputChannel

export async function activate(context: ExtensionContext) {
  const coreDir = 'vscode-wasm/wasm-wasi-core'
  const corePkgJSONRaw = await workspace.fs.readFile(Uri.joinPath(context.extensionUri, coreDir, 'package.json'))
  const corePkgJSON = JSON.parse(new TextDecoder().decode(corePkgJSONRaw)) as { version: string }

  const WasmAPILoader = await WasmWasiCore.activate({
    extensionUri: Uri.joinPath(context.extensionUri, coreDir),
    extension: {
      packageJSON: {
        version: corePkgJSON.version,
      }
    }
  })

  let alsModule = null

  class AgdaLanguageServerFactory {
    static HOME = '/home/user'
    static Agda_datadir = '/opt/agda'

    constructor(readonly wasm: Wasm, readonly module: WebAssembly.Module) {}

    private static eagain(): Error {
      const err: any = new Error("This read to stdin would block");
      err._isWasiError = true;
      err.errno = 6 /* Errno.again */;
      return err;
    }

    async createServer(processOptions: Partial<ProcessOptions> = {}) {
      const memfsTempDir = await this.wasm.createMemoryFileSystem()
      const memfsHome = await this.wasm.createMemoryFileSystem()
      const memfsAgdaDataDir = await this.wasm.createMemoryFileSystem()

      populateAgdaDataDir(memfsAgdaDataDir)

      const { HOME, Agda_datadir } = AgdaLanguageServerFactory

      const mountPoints: MountPointDescriptor[] = [
        { kind: 'workspaceFolder' },
        { kind: 'memoryFileSystem', fileSystem: memfsTempDir, mountPoint: '/tmp' },
        { kind: 'memoryFileSystem', fileSystem: memfsHome, mountPoint: HOME },
        { kind: 'memoryFileSystem', fileSystem: memfsAgdaDataDir, mountPoint: Agda_datadir },
      ]

      // patch the stdin pipe
      const stdio = createStdioOptions()
      const stdinPipe = this.wasm.createWritable()
      const origRead = (stdinPipe as any).read.bind(stdinPipe)
      ;(stdinPipe as any).read = function(mode?: 'max', size?: number) {
        // logger.appendLine(`STDIN READ mode=${mode} size=${size} chunks=${this.chunks}`)
        if (this.fillLevel == 0) {
          throw AgdaLanguageServerFactory.eagain();
        }
        return origRead(mode, size)
      }
      stdio.in = { kind: 'pipeIn', pipe: stdinPipe }

      const process = await this.wasm.createProcess('als', this.module, {
        initial: 256,
        maximum: 1024,
        shared: true,
      }, {
        env: {
          HOME,
          Agda_datadir,
        },
        stdio,
        args: [
          '+RTS', '-V1', '-RTS',
          // workaround (but to hide it) for the path issue which I haven't dig into
          '+AGDA', '-WnoDuplicateInterfaceFiles', '-AGDA'],
        mountPoints,
        trace: true,
        ...processOptions,
      });

      return startServer(process);
    }

    private async queryOutput(args: string[]) {
      const process = await this.wasm.createProcess('als', this.module, {
        args,
        stdio: { out: { kind: 'pipeOut' } },
      })

      let result = ''
      const decoder = new TextDecoder()
      process.stdout.onData(data => {
        result += decoder.decode(data, { stream: true })
      })
      await process.run()
      return (result + decoder.decode()).trimEnd()
    }

    async queryVersionString() {
      return this.queryOutput(['--version'])
    }
  }

  async function loadBuiltInALSModule() {
    const alsWasmRaw = await workspace.fs.readFile(Uri.joinPath(context.extensionUri, 'als.wasm'));
    return WebAssembly.compile(alsWasmRaw)
  }

  // Register a command that runs the C example
  commands.registerCommand('wasm-wasi-c-example.run', async () => {
    // Load the WASM module. It is stored alongside the extension JS code.
    // So we can use VS Code's file system API to load it. Makes it
    // independent of whether the code runs in the desktop or the web.

    const wasm = WasmAPILoader.load();
    if (alsModule == null) {
      alsModule = await loadBuiltInALSModule();
    }

    try {
      // const pty = wasm.createPseudoterminal()
      // const term = window.createTerminal({name: 'hello', pty})
      // term.show()

      // const proc = await wasm.createProcess('hello', module, {
      //   stdio: pty.stdio,
      //   mountPoints: [
      //     { kind: 'workspaceFolder' },
      //     { kind: 'vscodeFileSystem', uri: Uri.parse('untitled:/'), mountPoint: '/tmp' },
      //   ],
      //   trace: true,
      // })
      // await proc.run()
      // return

      if (logger == null) {
        logger = window.createOutputChannel('WASI example')
        traceLogger = window.createOutputChannel('LSP trace', { log: true })
      }

      const factory = new AgdaLanguageServerFactory(wasm, alsModule)
      logger.appendLine(await factory.queryVersionString())

      const transports = () => factory.createServer()

      const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'plaintext' }],
        outputChannel: logger,
        traceOutputChannel: traceLogger,
        uriConverters: createUriConverters(),
      };

      const client = new LanguageClient('als', 'Agda Language Server', transports, clientOptions)
      client.registerProposedFeatures()

      context.subscriptions.push(client);

      client.onRequest('agda', (res, opts) => {
        logger.appendLine(`FROM AGDA: ${JSON.stringify(res, null, 2)}`)
      })

      function mkreq(str: string) {
        const ss = JSON.stringify(str)
        return client.sendRequest('agda', {
          tag: 'CmdReq',
          contents: `IOTCM ${ss} None Indirect (Cmd_load ${ss} [])`,
        })
      }

      setTimeout(async () => {
        const files = [
          '/workspace/src/Data/Bool.agda',
        ]
        for (let i = 0; i < files.length; i++) {
          logger.appendLine('-'.repeat(20) + ` TYPECHECKING ${files[i]} ` + '-'.repeat(20))
          const resp = await mkreq(files[i]);
          logger.appendLine(`resp = ${JSON.stringify(resp)}`)
          await new Promise(r => setTimeout(r, 3000))
        }
      }, 3000)

      await client.start()
      logger.appendLine('Server has started')
    } catch (error) {
      // Show an error message if something goes wrong.
      void window.showErrorMessage(error.message);
    }
  });

  return {
    AgdaLanguageServerFactory,
    WasmAPILoader,
    loadBuiltInALSModule,
    createUriConverters,
  }
}

export function deactivate() {
}
