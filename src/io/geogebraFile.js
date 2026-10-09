/* GeoGebra ZIP/XML importer. Only construction data is interpreted. */
export async function geogebraXML(file) {
  if (file.size > 20 * 1024 * 1024) throw Error('File exceeds 20 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.xml$/i.test(file.name)) return new TextDecoder().decode(bytes);
  const v = new DataView(bytes.buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error('This is not a valid .ggb ZIP file');
  let pos = v.getUint32(end + 16, true);
  const count = v.getUint16(end + 10, true);
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || v.getUint32(pos, true) !== 0x02014b50)
      throw Error('Invalid ZIP directory');
    const flags = v.getUint16(pos + 8, true),
      method = v.getUint16(pos + 10, true),
      size = v.getUint32(pos + 20, true),
      expanded = v.getUint32(pos + 24, true),
      nl = v.getUint16(pos + 28, true),
      xl = v.getUint16(pos + 30, true),
      cl = v.getUint16(pos + 32, true),
      offset = v.getUint32(pos + 42, true),
      name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nl));
    if (name === 'geogebra.xml' || name.endsWith('/geogebra.xml')) {
      if (flags & 1) throw Error('Encrypted files are unsupported');
      if (expanded > 5 * 1024 * 1024) throw Error('Construction XML exceeds 5 MB');
      if (offset + 30 > bytes.length || v.getUint32(offset, true) !== 0x04034b50)
        throw Error('Invalid ZIP entry');
      const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
      if (start + size > bytes.length) throw Error('Truncated ZIP entry');
      let data = bytes.slice(start, start + size);
      if (method === 8) {
        const reader = new Blob([data])
            .stream()
            .pipeThrough(new DecompressionStream('deflate-raw'))
            .getReader(),
          chunks = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 5 * 1024 * 1024) {
            await reader.cancel();
            throw Error('Construction XML exceeds 5 MB');
          }
          chunks.push(value);
        }
        data = new Uint8Array(await new Blob(chunks).arrayBuffer());
      } else if (method !== 0) throw Error('Unsupported ZIP compression');
      return new TextDecoder().decode(data);
    }
    pos += 46 + nl + xl + cl;
  }
  throw Error('geogebra.xml was not found');
}
