/** Node's WebAssembly global, which the DOM-free server lib set does not declare. */
declare namespace WebAssembly {
  class Module {
    private constructor();
  }
  function compile(bytes: ArrayBuffer | Uint8Array): Promise<Module>;
}
