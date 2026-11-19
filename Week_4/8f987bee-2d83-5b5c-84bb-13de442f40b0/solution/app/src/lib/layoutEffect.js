import { useEffect, useLayoutEffect } from "react";

// Layout effects on the client, plain effects while prerendering on the server.
export const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
