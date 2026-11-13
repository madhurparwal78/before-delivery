import json, struct

pos_min = [-32767, 0, -32767]
pos_max = [32767, 32767, 32767]
bin_data = struct.pack('<6h', *pos_min, *pos_max)
gltf = {
  "asset": {"version": "2.0"},
  "scene": 0,
  "scenes": [{"nodes": [0]}],
  "nodes": [{"mesh": 0, "scale": [0.09, 0.21, 0.0425]}],
  "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
  "accessors": [{
    "componentType": 5122, "count": 6, "type": "VEC3",
    "min": pos_min, "max": pos_max, "normalized": True,
    "bufferView": 0, "byteOffset": 0,
  }],
  "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(bin_data), "target": 34962}],
  "buffers": [{"byteLength": len(bin_data)}],
  "extensionsUsed": ["KHR_mesh_quantization"],
  "extensionsRequired": ["KHR_mesh_quantization"],
}
json_bytes = json.dumps(gltf, separators=(',', ':')).encode()
pad = (4 - len(json_bytes) % 4) % 4
json_bytes += b'\x20' * pad
bin_pad = (4 - len(bin_data) % 4) % 4
bin_data += b'\0' * bin_pad

total = 12 + 8 + len(json_bytes) + 8 + len(bin_data)
out = b''
out += struct.pack('<4sII', b'glTF', 2, total)            # magic, version, total length
out += struct.pack('<I4s', len(json_bytes), b'JSON')      # chunk 0 header
out += json_bytes
out += struct.pack('<I4s', len(bin_data), b'BIN\x00')     # chunk 1 header
out += bin_data
assert len(out) == total, (len(out), total)
open('/tmp/product.glb', 'wb').write(out)
print('GLB written:', len(out), 'bytes; total field:', total)
