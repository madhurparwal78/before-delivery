import { createContext, useContext } from "react";

export const ConsoleContext = createContext(null);
export const useConsole = () => useContext(ConsoleContext);
