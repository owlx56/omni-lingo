type ZipEntry = {
  compressedSize: number;
  compression: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
};

type DecompressionStreamCtor = new (
  format: string,
) => TransformStream<Uint8Array, Uint8Array>;

const EOCD = 0x06054b50;
const CENTRAL_FILE = 0x02014b50;
const LOCAL_FILE = 0x04034b50;

export async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entries = readU16(view, eocdOffset + 10);
  let cursor = readU32(view, eocdOffset + 16);
  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < entries; i++) {
    if (readU32(view, cursor) !== CENTRAL_FILE) {
      throw new Error("Invalid ZIP central directory");
    }
    const entry = readCentralEntry(view, bytes, cursor);
    cursor += 46 + readU16(view, cursor + 28) + readU16(view, cursor + 30) + readU16(view, cursor + 32);
    if (entry.name.endsWith("/")) continue;
    files.set(entry.name, await readEntryData(view, bytes, entry));
  }

  return files;
}

function findEndOfCentralDirectory(view: DataView): number {
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= min; offset--) {
    if (readU32(view, offset) === EOCD) return offset;
  }
  throw new Error("Could not locate ZIP directory");
}

function readCentralEntry(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
): ZipEntry {
  const fileNameLength = readU16(view, offset + 28);
  const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
  return {
    compressedSize: readU32(view, offset + 20),
    compression: readU16(view, offset + 10),
    localHeaderOffset: readU32(view, offset + 42),
    name: new TextDecoder("utf-8").decode(nameBytes),
    uncompressedSize: readU32(view, offset + 24),
  };
}

async function readEntryData(
  view: DataView,
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const offset = entry.localHeaderOffset;
  if (readU32(view, offset) !== LOCAL_FILE) {
    throw new Error(`Invalid ZIP local header: ${entry.name}`);
  }
  const fileNameLength = readU16(view, offset + 26);
  const extraLength = readU16(view, offset + 28);
  const start = offset + 30 + fileNameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);

  if (entry.compression === 0) return data;
  if (entry.compression === 8) {
    const inflated = await inflateZipDeflate(data);
    if (
      entry.uncompressedSize > 0 &&
      inflated.byteLength !== entry.uncompressedSize
    ) {
      return inflated.subarray(0, entry.uncompressedSize);
    }
    return inflated;
  }
  throw new Error(`Unsupported ZIP compression method: ${entry.compression}`);
}

async function inflateZipDeflate(data: Uint8Array): Promise<Uint8Array> {
  try {
    return await decompress(data, "deflate-raw");
  } catch {
    return await decompress(data, "deflate");
  }
}

async function decompress(data: Uint8Array, format: string): Promise<Uint8Array> {
  const Ctor = globalThis.DecompressionStream as unknown as
    | DecompressionStreamCtor
    | undefined;
  if (!Ctor) {
    throw new Error("This browser does not provide DecompressionStream");
  }
  const stream = new Blob([copyArrayBuffer(data)])
    .stream()
    .pipeThrough(new Ctor(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function copyArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
