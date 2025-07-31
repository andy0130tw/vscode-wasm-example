/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MountPointDescriptor, Wasm } from '@vscode/wasm-wasi/v1';
import { commands, ExtensionContext, Uri, window, workspace } from 'vscode';
import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@vscode/wasm-wasi-lsp'
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient';
import { populateAgdaDataDir } from './data'

const logger = window.createOutputChannel('WASI example')
const logger2 = window.createOutputChannel('LSP trace', { log: true })

function eagain(): Error {
  const err: any = new Error("This read to stdin would block");
  err._isWasiError = true;
  err.errno = 6 /* Errno.again */;
  return err;
}

export async function activate(context: ExtensionContext) {

  // Load the WASM API
  const wasm: Wasm = await Wasm.load();

  // Register a command that runs the C example
  commands.registerCommand('wasm-wasi-c-example.run', async () => {
    // Load the WASM module. It is stored alongside the extension JS code.
    // So we can use VS Code's file system API to load it. Makes it
    // independent of whether the code runs in the desktop or the web.
    try {
      const bits = await workspace.fs.readFile(Uri.joinPath(context.extensionUri, 'als.wasm'));
      const module = await WebAssembly.compile(bits);

      const HOME = '/home/user'
      const Agda_datadir = '/opt/agda'

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

      const serverOptions: ServerOptions = async () => {

        const memfsTempDir = await wasm.createMemoryFileSystem()
        const memfsHome = await wasm.createMemoryFileSystem()
        const memfsAgdaDataDir = await wasm.createMemoryFileSystem()

        populateAgdaDataDir(memfsAgdaDataDir)

        const mountPoints: MountPointDescriptor[] = [
          { kind: 'workspaceFolder' },
          { kind: 'memoryFileSystem', fileSystem: memfsTempDir, mountPoint: '/tmp' },
          { kind: 'memoryFileSystem', fileSystem: memfsHome, mountPoint: HOME },
          { kind: 'memoryFileSystem', fileSystem: memfsAgdaDataDir, mountPoint: Agda_datadir },
        ]

        const stdinPipe = wasm.createWritable()
        const origRead = (stdinPipe as any).read.bind(stdinPipe)
        ;(stdinPipe as any).read = function(mode?: 'max', size?: number) {
          // logger.appendLine(`STDIN READ mode=${mode} size=${size} chunks=${this.chunks}`)
          if (this.fillLevel == 0) {
            throw eagain();
          }
          return origRead(mode, size)
        }
        const origWrite = (stdinPipe as any).write.bind(stdinPipe)
        stdinPipe.write = function(chunk: any, encoding?: 'utf-8') {
          // logger.appendLine(`STDIN WRITE chunk=${chunk} encoding=${encoding}`)
          return origWrite(chunk, encoding)
        }

        // Create a WASM process.
        const process = await wasm.createProcess('hello', module, {
          initial: 256,
          maximum: 1024,
          shared: true,
        }, {
          env: {
            HOME,
            Agda_datadir,
          },
          stdio: {...createStdioOptions(), in: { kind: 'pipeIn', pipe: stdinPipe } },
          args: [
            '+RTS', '-V1', '-RTS',
            // workaround (but to hide it) for the path issue which I haven't dig into
            '+AGDA', '-WnoDuplicateInterfaceFiles', '-AGDA'],
          mountPoints,
          // trace: true,
        });

        // Hook stderr to the output channel
        const decoder = new TextDecoder('utf-8');
        process.stderr!.onData(data => {
          logger.append(decoder.decode(data));
        });

        return startServer(process);
      }

      const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'plaintext' }],
        outputChannel: logger,
        traceOutputChannel: logger2,
        uriConverters: createUriConverters(),
      };

      const client = new LanguageClient('als', 'Agda Language Server', serverOptions, clientOptions)
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
}

export function deactivate() {
}
