declare module "draco3d" {
  interface DracoMesh {
    readonly __mesh: unique symbol;
  }

  interface DracoInt8Array {
    GetValue(index: number): number;
  }

  interface MeshBuilder {
    AddFacesToMesh(mesh: DracoMesh, faceCount: number, indices: Uint32Array): void;
    AddFloatAttributeToMesh(
      mesh: DracoMesh,
      attributeType: number,
      pointCount: number,
      componentCount: number,
      values: Float32Array,
    ): number;
  }

  interface Encoder {
    SetAttributeQuantization(attributeType: number, bits: number): void;
    SetSpeedOptions(encodingSpeed: number, decodingSpeed: number): void;
    SetEncodingMethod(method: number): void;
    EncodeMeshToDracoBuffer(mesh: DracoMesh, buffer: DracoInt8Array): number;
  }

  interface EncoderModule {
    readonly POSITION: number;
    readonly NORMAL: number;
    readonly TEX_COORD: number;
    readonly MESH_EDGEBREAKER_ENCODING: number;
    readonly MESH_SEQUENTIAL_ENCODING: number;
    Mesh: new () => DracoMesh;
    MeshBuilder: new () => MeshBuilder;
    Encoder: new () => Encoder;
    DracoInt8Array: new () => DracoInt8Array;
    destroy(value: unknown): void;
  }

  const draco3d: {
    createEncoderModule(options: Record<string, unknown>): Promise<EncoderModule>;
  };

  export default draco3d;
}
