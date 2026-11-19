/** The slice of the Draco encoder API the tower models are built with. */
declare module 'draco3d' {
  interface DracoInt8Array {
    GetValue(index: number): number;
  }

  interface DracoMesh {
    readonly __mesh: unique symbol;
  }

  interface MeshBuilder {
    AddFacesToMesh(mesh: DracoMesh, faceCount: number, indices: Uint32Array): boolean;
    AddFloatAttributeToMesh(
      mesh: DracoMesh,
      attribute: number,
      pointCount: number,
      componentCount: number,
      values: Float32Array,
    ): number;
  }

  interface Encoder {
    SetSpeedOptions(encodingSpeed: number, decodingSpeed: number): void;
    SetAttributeQuantization(attribute: number, bits: number): void;
    SetEncodingMethod(method: number): void;
    EncodeMeshToDracoBuffer(mesh: DracoMesh, out: DracoInt8Array): number;
  }

  interface EncoderModule {
    POSITION: number;
    MESH_EDGEBREAKER_ENCODING: number;
    Encoder: new () => Encoder;
    MeshBuilder: new () => MeshBuilder;
    Mesh: new () => DracoMesh;
    DracoInt8Array: new () => DracoInt8Array;
    destroy(value: Encoder | MeshBuilder | DracoMesh | DracoInt8Array): void;
  }

  export function createEncoderModule(options: Record<string, never>): Promise<EncoderModule>;
  const draco3d: { createEncoderModule: typeof createEncoderModule };
  export default draco3d;
}
