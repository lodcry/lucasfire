// Otimiza GLB: dedup, prune, weld, resample, meshopt e, se ainda grande, reduz texturas.
const MAX = 9 * 1024 * 1024;
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
let T;
async function tools() {
  if (T) return T;
  const core = await import('@gltf-transform/core');
  const ext = await import('@gltf-transform/extensions');
  const fn = await import('@gltf-transform/functions');
  const mo = await import('meshoptimizer');
  await mo.MeshoptEncoder.ready; await mo.MeshoptDecoder.ready;
  let sharp = null;
  try { sharp = (await import('sharp')).default; } catch {}
  const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': mo.MeshoptDecoder, 'meshopt.encoder': mo.MeshoptEncoder });
  T = { io, fn, mo, sharp };
  return T;
}

async function optimize(buf) {
  const { io, fn, mo, sharp } = await tools();
  const steps = [];
  let best = buf;
  for (const size of [null, 2048, 1024, 512]) {
    if (size && !sharp) { steps.push('sharp indisponível: texturas não reduzidas'); break; }
    const doc = await io.readBinary(buf);
    const tf = [fn.dedup(), fn.prune(), fn.resample(), fn.weld()];
    if (size) tf.push(fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size] }));
    tf.push(fn.meshopt({ encoder: mo.MeshoptEncoder, level: 'medium' }));
    await doc.transform(...tf);
    const out = Buffer.from(await io.writeBinary(doc));
    steps.push((size ? `texturas até ${size}px` : 'geometria + meshopt') + ': ' + mb(out.length));
    if (out.length < best.length) best = out;
    if (best.length <= MAX) break;
  }
  return { buffer: best, from: buf.length, to: best.length, steps };
}
module.exports = { optimize, mb };
