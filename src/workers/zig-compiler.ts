import {
  WASI,
  File,
  OpenFile,
  PreopenDirectory,
  type Fd,
  type Inode,
} from "@bjorn3/browser_wasi_shim";
import { getZigStdlib, stderrOutput } from "../lib/zig-utils";

let currentlyRunning = false;
let zigModulePromise: Promise<WebAssembly.Module> | null = null;
let libDirectoryPromise: ReturnType<typeof getZigStdlib> | null = null;

function getZigModule(): Promise<WebAssembly.Module> {
  if (!zigModulePromise) {
    zigModulePromise = WebAssembly.compileStreaming(fetch("/zig.wasm"));
  }
  return zigModulePromise;
}

function getLib() {
  if (!libDirectoryPromise) {
    libDirectoryPromise = getZigStdlib();
  }
  return libDirectoryPromise;
}


async function run(zigSource: string) {
  if (currentlyRunning) return;
  currentlyRunning = true;

  const [zigModule, libDirectory] = await Promise.all([getZigModule(), getLib()]);

  const args = [
    "zig.wasm",
    "build-exe",
    "main.zig",
    "-fno-llvm",
    "-fno-lld",
    "-fno-ubsan-rt",
    "-fno-entry",
  ];
  const fds: Fd[] = [
    new OpenFile(new File([])),
    stderrOutput(),
    stderrOutput(),
    new PreopenDirectory(
      ".",
      new Map<string, Inode>([
        ["main.zig", new File(new TextEncoder().encode(zigSource))],
      ])
    ),
    new PreopenDirectory("/lib", libDirectory.contents),
    new PreopenDirectory("/cache", new Map()),
  ];
  const wasi = new WASI(args, [], fds, { debug: false });

  const instance = await WebAssembly.instantiate(zigModule, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  postMessage({ stderr: "Compiling Zig...\n" });

  try {
    // @ts-ignore
    const exitCode = wasi.start(instance);

    if (exitCode === 0) {
      const cwd = wasi.fds[3] as PreopenDirectory;
      const mainWasm = cwd.dir.contents.get("main.wasm") as File | undefined;
      if (mainWasm) {
        postMessage({ compiled: mainWasm.data });
      }
    }
  } catch (err) {
    postMessage({ stderr: `${err}` });
    postMessage({ failed: true });
  }

  currentlyRunning = false;
}

onmessage = (event) => {
  if (event.data.run) {
    run(event.data.run);
  }
};
