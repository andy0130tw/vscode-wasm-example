/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeFileSystemDescriptor, Wasm } from '@vscode/wasm-wasi/v1';
import { commands, ExtensionContext, Uri, window, workspace } from 'vscode';
import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@vscode/wasm-wasi-lsp'
import { LanguageClient, LanguageClientOptions, ServerOptions, RequestType } from 'vscode-languageclient/node';

const nodeProcess = typeof process !== 'undefined' ? process : null
const logger = window.createOutputChannel('WASI example')

function eagain(): Error {
  const err: any = new Error("This read to stdin would block");
  err._isWasiError = true;
  err.errno = 6;
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

      const HOME = nodeProcess?.env.HOME ?? '/root'

      const serverOptions: ServerOptions = async () => {
        const fs: VSCodeFileSystemDescriptor = {
          kind: 'vscodeFileSystem',
          // the host path to mount
          uri: Uri.file(HOME),
          mountPoint: HOME,
        }

        const stdinPipe = wasm.createWritable()
        const origRead = (stdinPipe as any).read.bind(stdinPipe)
        ;(stdinPipe as any).read = function(mode?: 'max', size?: number) {
          logger.appendLine(`STDIN READ mode=${mode} size=${size} chunks=${this.chunks}`)
          if (this.fillLevel == 0) {
            throw eagain();
          }
          return origRead(mode, size)
        }
        const origWrite = (stdinPipe as any).write.bind(stdinPipe)
        stdinPipe.write = function(chunk: any, encoding?: 'utf-8') {
          logger.appendLine(`STDIN WRITE chunk=${chunk} encoding=${encoding}`)
          return origWrite(chunk, encoding)
        }

        // Create a WASM process.
        const process = await wasm.createProcess('hello', module, {
          initial: 1024,
          maximum: 1024,
          shared: true,
        }, {
          stdio: {...createStdioOptions(), in: { kind: 'pipeIn', pipe: stdinPipe } },
          mountPoints: [fs],
          // trace: true,
        });

        // Hook stderr to the output channel
        const decoder = new TextDecoder('utf-8');
        process.stdout!.onData((data) => {
          logger.append('[STDOUT ' + decoder.decode(data) + ']\n');
        });
        process.stderr!.onData(data => {
          logger.append(decoder.decode(data));
        });

        return startServer(process);
      }

      const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'plaintext' }],
        outputChannel: logger,
        uriConverters: createUriConverters(),
        middleware: {
          provideHover(d, p, t, n) {
            logger.appendLine('PROVIDE HOVER! ' + JSON.stringify(p));
            return n(d, p, t)
          }
        }
      };

      const client = new LanguageClient('als', 'Agda Language Server', serverOptions, clientOptions)
      client.registerProposedFeatures()

      context.subscriptions.push(client);

      await client.start()
      logger.appendLine('Server has shutdown')
    } catch (error) {
      // Show an error message if something goes wrong.
      void window.showErrorMessage(error.message);
    }
  });
}

export function deactivate() {
}
