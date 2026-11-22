import * as THREE from '../vendor/three160.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader160.js';

export const MAX_GLB_TRIANGLES = 25000;

/**
 * Generic external .glb model loader & normalizer (Fase 2):
 * - Uses Three.js r160 GLTFLoader
 * - Rejects models exceeding 25,000 triangles with a clear error message
 * - Normalizes orientation (longest bounding-box axis -> X), pivot (centered at 0,0,0),
 *   and scale (longest X span -> targetLength)
 * - Extracts solid color from material.color and/or vertex colors; ignores textures
 * - Registers normalized meshes with engine's addPart() so both Canvas2D and WebGL
 *   toon/outline/cutaway pipelines work seamlessly.
 */
export async function loadNormalizedGlb(url, addPart, parentGroup, opts = {}) {
  const maxTris = opts.maxTriangles ?? MAX_GLB_TRIANGLES;
  const targetLength = opts.targetLength ?? 1.0;
  const loader = new GLTFLoader();

  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      url,
      resolve,
      undefined,
      (err) => reject(new Error(`Failed to load GLB "${url}": ${err?.message || err}`))
    );
  });

  const srcRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!srcRoot) {
    throw new Error(`GLB "${url}" contains no scene.`);
  }
  srcRoot.updateMatrixWorld(true);

  // 1. Collect meshes & enforce 25,000-triangle budget BEFORE building parts
  const rawMeshes = [];
  let totalTriangles = 0;
  srcRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry || !obj.geometry.attributes.position) return;
    const g = obj.geometry;
    const tris = g.index ? Math.floor(g.index.count / 3) : Math.floor(g.attributes.position.count / 3);
    totalTriangles += tris;
    rawMeshes.push({ mesh: obj, tris });
  });

  if (rawMeshes.length === 0 || totalTriangles === 0) {
    throw new Error(`GLB "${url}" contains no renderable triangle meshes.`);
  }
  if (totalTriangles > maxTris) {
    throw new Error(
      `GLB model "${url}" rejected: ${totalTriangles} triangles exceeds maximum limit of ${maxTris} triangles.`
    );
  }

  // 2. Compute world bounding box of all meshes to determine longest axis, pivot, and scale
  const worldBox = new THREE.Box3();
  const bakedItems = [];
  for (const { mesh } of rawMeshes) {
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    g.computeBoundingBox();
    worldBox.union(g.boundingBox);

    // Extract material color (ignoring textures) or vertex colors
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    let hexColor = opts.fallbackColor ?? 0x56687f;
    let hasVertexColors = Boolean(g.attributes.color);
    if (mat && mat.color && typeof mat.color.getHex === 'function') {
      const c = mat.color.clone();
      // If material has no vertex colors and is pure untextured default white, apply subtle neutral tint option
      if (!hasVertexColors && opts.neutralWhiteFallback && c.r > 0.96 && c.g > 0.96 && c.b > 0.96) {
        hexColor = opts.neutralWhiteFallback;
      } else {
        hexColor = c.getHex();
      }
    }
    bakedItems.push({ geo: g, hexColor, hasVertexColors, name: mesh.name || 'part' });
  }

  const size = worldBox.getSize(new THREE.Vector3());
  const center = worldBox.getCenter(new THREE.Vector3());

  // 3. Build normalization matrix:
  //    a) Translate bbox center -> (0,0,0) (pivot)
  //    b) Rotate longest axis -> X axis
  //    c) Uniform scale so X span == targetLength
  const rotMat = new THREE.Matrix4();
  let longestSpan = size.x;
  let longestAxis = 'x';
  if (size.z >= size.x && size.z >= size.y) {
    // Rotate +Z onto +X (-90 deg around Y)
    rotMat.makeRotationY(-Math.PI / 2);
    longestSpan = size.z;
    longestAxis = 'z';
  } else if (size.y >= size.x && size.y >= size.z) {
    // Rotate +Y onto +X (-90 deg around Z)
    rotMat.makeRotationZ(-Math.PI / 2);
    longestSpan = size.y;
    longestAxis = 'y';
  }
  const scaleFactor = longestSpan > 1e-6 ? targetLength / longestSpan : 1.0;

  const normMat = new THREE.Matrix4();
  const tMat = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
  const sMat = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
  normMat.multiply(sMat).multiply(rotMat).multiply(tMat);

  const modelGroup = new THREE.Group();
  parentGroup.add(modelGroup);

  const parts = [];
  const normBox = new THREE.Box3();
  for (const item of bakedItems) {
    item.geo.applyMatrix4(normMat);
    item.geo.computeVertexNormals();
    item.geo.computeBoundingBox();
    normBox.union(item.geo.boundingBox);

    const part = addPart(modelGroup, item.geo, item.hexColor, {
      smooth: true,
      useVertexColors: item.hasVertexColors,
      depthBias: opts.depthBias ?? 0.002,
      outlineStrength: opts.outlineStrength ?? 1.0,
    });
    parts.push(part);
  }

  const normSize = normBox.getSize(new THREE.Vector3());
  return {
    group: modelGroup,
    parts,
    meta: {
      url,
      meshCount: rawMeshes.length,
      triangleCount: totalTriangles,
      originalLongestAxis: longestAxis,
      originalSize: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
      normalizedSize: [+normSize.x.toFixed(3), +normSize.y.toFixed(3), +normSize.z.toFixed(3)],
      scaleFactor: +scaleFactor.toFixed(4),
    },
  };
}
