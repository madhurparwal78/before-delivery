import type { VNode } from 'preact';

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }): VNode {
  return (
    <span class={className} style={`width:${size}px;height:${size}px;display:inline-flex;flex:0 0 auto;`} aria-hidden="true">
      <img src={`/icons/${name}.svg`} alt="" style="width:100%;height:100%;" />
    </span>
  );
}
