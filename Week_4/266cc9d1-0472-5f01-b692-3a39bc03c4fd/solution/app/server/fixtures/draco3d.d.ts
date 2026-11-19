// Types for the part of the draco3d encoder the fixture tileset uses.
declare module "draco3d" {
  interface DracoObject {
    readonly __draco: unique symbol;
  }
  interface DracoMesh extends DracoObject {}
  interface DracoInt8Array extends DracoObject {
    GetValue(index: number): number;
  }
  interface MeshBuilder extends DracoObject {
    AddFacesToMesh(mesh: DracoMesh, faceCount: number, indices: Uint32Array): boolean;
    AddFloatAttributeToMesh(mesh: DracoMesh, attribute: number, pointCount: number, components: number, values: Float32Array): number;
  }
  interface Encoder extends DracoObject {
    SetSpeedOptions(encodeSpeed: number, decodeSpeed: number): void;
    SetAttributeQuantization(attribute: number, bits: number): void;
    SetEncodingMethod(method: number): void;
    EncodeMeshToDracoBuffer(mesh: DracoMesh, out: DracoInt8Array): number;
  }
  interface EncoderModule {
    Encoder: new () => Encoder;
    MeshBuilder: new () => MeshBuilder;
    Mesh: new () => DracoMesh;
    DracoInt8Array: new () => DracoInt8Array;
    POSITION: number;
    NORMAL: number;
    TEX_COORD: number;
    MESH_EDGEBREAKER_ENCODING: number;
    destroy(object: DracoObject): void;
  }
  export function createEncoderModule(options: Record<string, never>): Promise<EncoderModule>;
}
