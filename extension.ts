/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StdioPipeInDescriptor, VSCodeFileSystemDescriptor, Wasm } from '@vscode/wasm-wasi/v1';
import { commands, ExtensionContext, Uri, window, workspace } from 'vscode';

const logger = window.createOutputChannel('WASI example')

export async function activate(context: ExtensionContext) {

  // Load the WASM API
  const wasm: Wasm = await Wasm.load();

  // Register a command that runs the C example
  commands.registerCommand('wasm-wasi-c-example.run', async () => {
    // Create a pseudoterminal to provide stdio to the WASM process.
    const pty = wasm.createPseudoterminal();
    const terminal = window.createTerminal({ name: 'Run C Example', pty, isTransient: true });
    terminal.show(true);

    // Load the WASM module. It is stored alongside the extension JS code.
    // So we can use VS Code's file system API to load it. Makes it
    // independent of whether the code runs in the desktop or the web.
    try {
      const bits = await workspace.fs.readFile(Uri.joinPath(context.extensionUri, 'hello.wasm'));
      const module = await WebAssembly.compile(bits);

      const HOME = '/Users/qbane'

      const fs: VSCodeFileSystemDescriptor = {
        kind: 'vscodeFileSystem',
        // the host path to mount
        uri: Uri.parse('file:///Users/qbane'),
        mountPoint: HOME,
      }
      const stdinPipe = wasm.createWritable()
      await stdinPipe.write('IOTCM "x.agda" None Direct (Cmd_show_version)\n')

      // Create a WASM process.
      const process = await wasm.createProcess('hello', module, {
        stdio: {
          in: { kind: 'pipeIn', pipe: stdinPipe } satisfies StdioPipeInDescriptor,
          out: pty.stdio.out,
          err: pty.stdio.err,
        },
        env: {
          // HOME,
          PWD: HOME,
          // Agda_datadir: HOME + '/ghc-wasm-project/agda',
        },
        // args: ['--interaction', '+RTS', '-V1'],
        mountPoints: [fs]
      });

      // signal the stdin close
      // *MUST* run after the process has been started, or the receiving end
      // would fail interpreting this as stream end
      setTimeout(() => stdinPipe.write(''), 1000)

      // Run the process and wait for its result.
      const result = await process.run();

      logger.appendLine("Process has exited with code " + result);
    } catch (error) {
      // Show an error message if something goes wrong.
      void window.showErrorMessage(error.message);
    }
  });
}

export function deactivate() {
}
