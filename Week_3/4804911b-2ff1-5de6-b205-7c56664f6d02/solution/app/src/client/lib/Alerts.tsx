import { useLayoutEffect, useRef } from "preact/hooks";
import { COPY } from "../../shared/copy";

/** The two outage banners. They stick to the top of the screen so a dialog below them never hides them. */
export function Alerts({ messages, work }: { messages: boolean; work: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const set = () => document.documentElement.style.setProperty("--alerts-h", `${box.current?.offsetHeight ?? 0}px`);
    set();
    const observer = new ResizeObserver(set);
    if (box.current) observer.observe(box.current);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty("--alerts-h", "0px");
    };
  }, []);
  return (
    <div class="alerts" ref={box} data-above-modal>
      {messages && (
        <div role="alert" aria-label="Message status" class="alert">
          {COPY.messageOutage}
        </div>
      )}
      {work && (
        <div role="alert" aria-label="Work status" class="alert">
          {COPY.workOutage}
        </div>
      )}
    </div>
  );
}
