import { Moon } from "lucide-react";
import { useStore } from "../store";

const REST_COPY = "Resting: missed dailies will not hurt you or your party.";

export function RestBanner() {
  const resting = useStore((state) => state.me?.resting);
  if (!resting) return null;
  return (
    <div className="rest-banner" role="status">
      <Moon aria-hidden="true" size={20} />
      <span>{REST_COPY}</span>
    </div>
  );
}
