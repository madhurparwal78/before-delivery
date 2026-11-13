const rkDefine = (window as unknown as { rkDefine?: (id: string, factory: (require: (id: string) => unknown) => Record<string, unknown>) => void }).rkDefine;
if (rkDefine !== undefined) {
  rkDefine("bootstrap", (require: (id: string) => unknown) => {
    void require("app");
    return {};
  });
}
