import { defineConfig } from "vite";
import * as lucide from "lucide";

const ICONS = [
  "Search",
  "Inbox",
  "FileText",
  "ListTree",
  "Map",
  "Building2",
  "Upload",
  "Settings",
  "LogOut",
  "Link2",
  "Link",
  "Unlink",
  "Check",
  "X",
  "Clock",
  "AlarmClock",
  "Pencil",
  "Trash2",
  "ChevronLeft",
  "ChevronRight",
  "ChevronDown",
  "GripVertical",
  "PanelRightClose",
  "PanelRightOpen",
  "Snowflake",
  "Send",
  "Copy",
  "RefreshCw",
  "EyeOff",
  "Mail",
  "Paperclip",
  "Circle",
  "CircleCheck",
  "CircleDashed",
  "AlertCircle",
  "ArrowRight",
  "Plus",
  "Users",
  "Target",
  "CalendarClock",
  "Globe",
  "Lock",
  "Flag",
];

const iconData: Record<string, unknown> = {};
const available = lucide as unknown as Record<string, unknown>;
for (const name of ICONS) {
  const node = available[name];
  if (node !== undefined) iconData[name] = node;
}

export default defineConfig({
  publicDir: "public",
  build: {
    target: "es2022",
    outDir: "dist/client",
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  esbuild: {
    jsx: "transform",
    jsxFactory: "h",
    jsxFragment: "Fragment",
  },
  define: {
    lucideIcons: JSON.stringify(iconData),
  },
});
