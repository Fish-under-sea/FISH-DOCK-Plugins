// CRC-32（IEEE 802.3，多项式 0xEDB88320），纯 JS 实现。
//
// 为什么不用 node:zlib 的 crc32：在本机 Node 24.14 上只要前面跑过
// deflateRawSync / inflateRawSync，同一个 Buffer 的 crc32() 会返回**不同的值**
// （实测同一个 78.8MB 文件：先算得 4217948559，先 deflate 再算得 4040762910，
// inflate 之后再算得 810990126）。打包与校验各自读到不同的数，verify-release
// 就报「ZIP CRC 或长度错误」。自己算一张表，结果与调用顺序无关。

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes, value = 0) {
  let c = (value ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
