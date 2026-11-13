import { useEffect } from "react";
import { usePlace } from "./router.js";
import { PublicApp } from "./public/PublicApp.js";
import { StaffApp } from "./staff/StaffApp.js";
import { setSceneDim, SHEET_DIM } from "./state/story.js";

/** The staff sheets slide over the same dimmed scene as the public ones. */
const StaffBackdrop = () => {
  useEffect(() => {
    setSceneDim(SHEET_DIM);
  }, []);
  return null;
};

export const App = () => {
  const { pathname } = usePlace();
  return pathname.startsWith("/staff") ? (
    <>
      <StaffBackdrop />
      <StaffApp path={pathname} />
    </>
  ) : (
    <PublicApp />
  );
};
