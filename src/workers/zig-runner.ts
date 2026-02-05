import {
  WASI,
  File,
  OpenFile,
  PreopenDirectory,
} from "@bjorn3/browser_wasi_shim";
import { stderrOutput } from "../lib/zig-utils";

async function run(wasmData: Uint8Array) {
  const args = ["main.wasm"];
  const env: string[] = [];
  const fds = [
    new OpenFile(new File([])), // stdin
    stderrOutput(), // stdout
    stderrOutput(), // stderr
    new PreopenDirectory(".", new Map([])),
  ];
  const wasi = new WASI(args, env, fds);

  // @ts-ignore - wasmData is a compiled module buffer
  const { instance } = await WebAssembly.instantiate(wasmData, {
    wasi_snapshot_preview1: wasi.wasiImport,
  }) as { instance: WebAssembly.Instance };

  try {
    // @ts-ignore
    const exitCode = wasi.start(instance);
    postMessage({
      stderr: `\n---\nexit code ${exitCode}\n---\n`,
    });
  } catch (err) {
    postMessage({ stderr: `${err}` });
  }

  postMessage({ done: true });
}

onmessage = (event) => {
  if (event.data.run) {
    run(event.data.run);
  }
};
