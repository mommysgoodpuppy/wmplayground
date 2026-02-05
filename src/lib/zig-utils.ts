import { untar } from "@andrewbranch/untar.js";
import {
  Directory,
  File,
  ConsoleStdout,
  wasi as wasi_defs,
} from "@bjorn3/browser_wasi_shim";

export async function getZigStdlib(): Promise<Directory> {
  const response = await fetch("/zig.tar.gz");
  let arrayBuffer = await response.arrayBuffer();
  const magicNumber = new Uint8Array(arrayBuffer).slice(0, 2);
  if (magicNumber[0] === 0x1f && magicNumber[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const decompressed = new Response(
      new Response(arrayBuffer).body!.pipeThrough(ds)
    );
    arrayBuffer = await decompressed.arrayBuffer();
  }
  const entries = untar(arrayBuffer);

  type TreeNode = Map<string, TreeNode | Uint8Array>;
  const root: TreeNode = new Map();

  for (const e of entries) {
    if (!e.filename.startsWith("lib/")) continue;
    const path = e.filename.slice("lib/".length);
    const splitPath = path.split("/");

    let c = root;
    for (const segment of splitPath.slice(0, -1)) {
      if (!c.has(segment)) {
        c.set(segment, new Map());
      }
      c = c.get(segment) as TreeNode;
    }
    c.set(splitPath[splitPath.length - 1], e.fileData);
  }

  function convert(node: TreeNode): Directory {
    return new Directory(
      [...node.entries()].map(([key, value]) => {
        if (value instanceof Uint8Array) {
          return [key, new File(value)] as [string, File];
        } else {
          return [key, convert(value)] as [string, Directory];
        }
      })
    );
  }

  return convert(root);
}

export function stderrOutput(): ConsoleStdout {
  const dec = new TextDecoder("utf-8", { fatal: false });
  const stderr = new ConsoleStdout((buffer) => {
    postMessage({ stderr: dec.decode(buffer, { stream: true }) });
  });
  stderr.fd_pwrite = (_data, _offset) => {
    return { ret: wasi_defs.ERRNO_SPIPE, nwritten: 0 };
  };
  return stderr;
}
