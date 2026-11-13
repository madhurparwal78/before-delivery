import type { ReactNode } from "react";
import { useTitle } from "../../lib/hooks";
import { CodeStep } from "./parts";

export default function SignupCode(): ReactNode {
  useTitle("enter your code");
  return <CodeStep kind="signup" />;
}
